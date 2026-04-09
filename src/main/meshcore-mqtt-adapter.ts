import { EventEmitter } from 'events';
import * as mqtt from 'mqtt';

import type { MQTTSettings, MQTTStatus } from '../renderer/lib/types';
import type { MeshcoreMqttChatEnvelopeV1 } from '../shared/meshcoreMqttEnvelope';
import { tryParseMeshcoreMqttChatEnvelope } from '../shared/meshcoreMqttEnvelope';
import {
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '../shared/meshtasticMqttReconnect';
import { sanitizeLogMessage } from './log-service';

export type { MeshcoreMqttChatEnvelopeV1 } from '../shared/meshcoreMqttEnvelope';

function normalizePrefix(prefix: string): string {
  const p = (prefix || 'msh').trim();
  return p.endsWith('/') ? p.slice(0, -1) : p;
}

/** For debug logs only — actual connect uses the same option-object shape as MQTTManager. */
function buildMeshcoreUrlForLog(settings: MQTTSettings): string {
  const host = settings.server.trim();
  if (settings.useWebSocket) {
    const scheme = settings.port === 443 || settings.tlsInsecure !== true ? 'wss' : 'ws';
    return `${scheme}://${host}:${settings.port}/mqtt`;
  }
  return settings.port === 8883
    ? `mqtts://${host}:${settings.port}`
    : `mqtt://${host}:${settings.port}`;
}

/** Time allowed for TCP/TLS/WebSocket + MQTT CONNACK (slow networks, captive portals). */
const MESHCORE_MQTT_CONNECT_ACK_MS = 30_000;
/** Send WebSocket-level ping frames so LB/proxy idle timers see traffic at ~10s intervals. */
const MESHCORE_MQTT_WSS_PING_MS = 10_000;
const MESHCORE_MQTT_RESCHEDULE_MS = 60_000;
/** Reconnect delay base/cap — mirrors MQTTManager. */
const MESHCORE_MQTT_RECONNECT_IMMEDIATE_MS = 500;
const MESHCORE_MQTT_RECONNECT_10_MINUTE_DELAY_MS = 600_000;

export class MeshcoreMqttAdapter extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private status: MQTTStatus = 'disconnected';
  private clientIdStr = '';
  private lastSettings: MQTTSettings | null = null;
  private connectAckTimer: ReturnType<typeof setTimeout> | null = null;
  /** True when a watchdog tore the client down — suppress noisy subscribe(err) after. */
  private connectAbortByWatchdog = false;
  /** One-shot: log first inbound MQTT message for broker delivery diagnostics. */
  private firstMessageLogged = false;
  private wssPingTimer: ReturnType<typeof setInterval> | null = null;
  private pingReqLogged = false;
  private pingRespLogged = false;
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wssRescheduleTimer: ReturnType<typeof setInterval> | null = null;
  private lastConnected: number | null = null;
  private disconnectCount = 0;
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** True when a token refresh was requested on close — hold reconnect until updateToken() fires. */
  private pendingReconnect = false;
  private pendingReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Grace period before expiry to trigger proactive refresh (5 minutes in ms). */
  private static readonly TOKEN_GRACE_PERIOD_MS = 5 * 60 * 1000;
  /** Proactive refresh schedule (50 minutes in ms = 90% of 60-minute token). */
  private static readonly PROACTIVE_REFRESH_MS = 54 * 60 * 1000;
  /** Safety timeout: if renderer never responds to token refresh request, reconnect anyway. */
  private static readonly PENDING_RECONNECT_TIMEOUT_MS = 10_000;

  /** Event emitted when token needs refresh (before reconnect). */
  static readonly EVENT_TOKEN_REFRESH_NEEDED = 'tokenRefreshNeeded';
  /** Event emitted when proactive token refresh should occur. */
  static readonly EVENT_PROACTIVE_TOKEN_REFRESH = 'proactiveTokenRefresh';

  getStatus(): MQTTStatus {
    return this.status;
  }

  getClientId(): string {
    return this.clientIdStr;
  }

  getSettings(): MQTTSettings | null {
    return this.lastSettings;
  }

  getTokenInfo(serverHost: string): { token: string; expiresAt: number } | null {
    const settings = this.lastSettings;
    if (!settings?.server || settings.server !== serverHost) return null;
    const expiresAt = settings.tokenExpiresAt;
    if (!expiresAt || !settings.password) return null;
    return { token: settings.password, expiresAt };
  }

  updateToken(token: string, expiresAt: number): void {
    if (this.lastSettings) {
      this.lastSettings.password = token;
      this.lastSettings.tokenExpiresAt = expiresAt;
    }
    this.clearTokenRefreshTimer();
    if (this.status === 'connected') {
      this.scheduleTokenRefresh();
    }
    if (this.pendingReconnect && this.lastSettings) {
      this.pendingReconnect = false;
      if (this.pendingReconnectTimer) {
        clearTimeout(this.pendingReconnectTimer);
        this.pendingReconnectTimer = null;
      }
      console.debug('[MeshcoreMqttAdapter] Token updated, triggering pending reconnect');
      this._doConnect(this.lastSettings);
    }
  }

  private clearTokenRefreshTimer(): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  private scheduleTokenRefresh(): void {
    this.clearTokenRefreshTimer();
    const expiresAt = this.lastSettings?.tokenExpiresAt;
    if (!expiresAt || this.status !== 'connected') return;
    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;
    // Schedule proactive refresh at fixed offset before expiry (5 min), cap at 54 min max
    const refreshAt = Math.max(0, timeUntilExpiry - MeshcoreMqttAdapter.TOKEN_GRACE_PERIOD_MS);
    const scheduleMs = Math.min(refreshAt, MeshcoreMqttAdapter.PROACTIVE_REFRESH_MS);
    if (scheduleMs <= 0) {
      console.debug(
        '[MeshcoreMqttAdapter] token already within grace period, skipping proactive refresh schedule',
      );
      return;
    }
    console.debug(
      '[MeshcoreMqttAdapter] scheduling proactive token refresh',
      `in ${Math.round(scheduleMs / 1000 / 60)}min (expires in ${Math.round(timeUntilExpiry / 1000 / 60)}min)`,
    );
    this.tokenRefreshTimer = setTimeout(() => {
      if (this.status !== 'connected' || !this.lastSettings) return;
      console.debug('[MeshcoreMqttAdapter] proactive token refresh fired');
      this.emit(MeshcoreMqttAdapter.EVENT_PROACTIVE_TOKEN_REFRESH, this.lastSettings.server);
    }, scheduleMs);
  }

  private needsTokenRefresh(): boolean {
    const expiresAt = this.lastSettings?.tokenExpiresAt;
    if (!expiresAt) return false;
    const now = Date.now();
    return expiresAt - now <= MeshcoreMqttAdapter.TOKEN_GRACE_PERIOD_MS;
  }

  private clearConnectTimers(): void {
    if (this.connectAckTimer) {
      clearTimeout(this.connectAckTimer);
      this.connectAckTimer = null;
    }
  }

  private clearWssPing(): void {
    if (this.wssPingTimer) {
      clearInterval(this.wssPingTimer);
      this.wssPingTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearWssReschedule(): void {
    if (this.wssRescheduleTimer) {
      clearInterval(this.wssRescheduleTimer);
      this.wssRescheduleTimer = null;
    }
  }

  private startWssReschedule(): void {
    this.clearWssReschedule();
    this.wssRescheduleTimer = setInterval(() => {
      if (!this.client?.connected) return;
      const s = this.client?.stream as { ping?: () => void; _reschedule?: () => void } | undefined;
      try {
        s?.ping?.();
        s?._reschedule?.();
      } catch {
        // catch-no-log-ok ws ping after teardown
      }
    }, MESHCORE_MQTT_RESCHEDULE_MS);
  }

  private setError(message: string): void {
    this.status = 'error';
    this.emit('status', 'error');
    this.emit('error', message);
  }

  disconnect(): void {
    this.clearTokenRefreshTimer();
    this.clearConnectTimers();
    this.clearWssPing();
    this.clearWssReschedule();
    this.clearReconnectTimer();
    this.pendingReconnect = false;
    if (this.pendingReconnectTimer) {
      clearTimeout(this.pendingReconnectTimer);
      this.pendingReconnectTimer = null;
    }
    this.retryCount = 0;
    if (this.client) {
      try {
        this.client.removeAllListeners();
        this.client.end(true);
      } catch (e) {
        console.warn(
          '[MeshcoreMqttAdapter] disconnect',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
      this.client = null;
    }
    this.lastSettings = null;
    this.setStatus('disconnected');
  }

  connect(settings: MQTTSettings): void {
    this.disconnect();
    this.lastSettings = settings;
    this.retryCount = 0;
    this._doConnect(settings);
  }

  private _doConnect(settings: MQTTSettings): void {
    if (this.client) {
      try {
        this.client.removeAllListeners();
        this.client.end(true);
      } catch {
        // catch-no-log-ok forced end before reconnect
      }
      this.client = null;
    }
    const clientId = `meshcore-mqtt-${Math.random().toString(36).slice(2, 10)}`;
    const useTls = settings.port === 8883;
    const rejectUnauthorizedTls = useTls ? !settings.tlsInsecure : false;
    const logUrl = buildMeshcoreUrlForLog(settings);

    // Match MQTTManager: WebSocket uses mqtt.connect({ protocol, host, port, path, … }) — not
    // mqtt.connect(urlString, opts), which can hang or mis-handle TLS in Node mqtt.js.
    // For WebSocket, set keepalive=0 to disable MQTT PINGREQ (broker doesn't respond to PINGRESP);
    // rely on WebSocket-level ping frames (MESHCORE_MQTT_WSS_PING_MS) to keep connection alive.
    const keepaliveSec = settings.useWebSocket ? 0 : (settings.keepalive ?? 60);
    let connectOpts: mqtt.IClientOptions = {
      clientId,
      username: settings.username || undefined,
      password: settings.password || undefined,
      clean: true,
      keepalive: keepaliveSec,
      reconnectPeriod: 0,
      connectTimeout: MESHCORE_MQTT_CONNECT_ACK_MS,
      protocolVersion: 4,
    };
    if (settings.useWebSocket) {
      const wsScheme = settings.port === 443 || settings.tlsInsecure !== true ? 'wss' : 'ws';
      connectOpts = {
        ...connectOpts,
        protocol: wsScheme,
        host: settings.server.trim(),
        port: settings.port,
        path: '/mqtt',
        rejectUnauthorized: settings.port === 443 ? true : rejectUnauthorizedTls,
        // Prefer IPv4 when DNS returns AAAA first but the path is broken (reduces WSS hangs).
        wsOptions: { family: 4 },
      };
    } else {
      connectOpts = {
        ...connectOpts,
        host: settings.server.trim(),
        port: settings.port,
        protocol: useTls ? 'mqtts' : 'mqtt',
        rejectUnauthorized: rejectUnauthorizedTls,
      };
    }

    console.debug(
      '[MeshcoreMqttAdapter] connect start',
      sanitizeLogMessage(logUrl),
      'ws:',
      settings.useWebSocket,
      'keepaliveSec:',
      keepaliveSec,
      'tlsInsecure:',
      settings.tlsInsecure === true,
    );
    this.firstMessageLogged = false;
    this.setStatus('connecting');
    this.connectAbortByWatchdog = false;
    this.client = mqtt.connect(connectOpts);
    this.connectAckTimer = setTimeout(() => {
      this.connectAckTimer = null;
      if (this.status !== 'connecting' || !this.client) return;
      this.connectAbortByWatchdog = true;
      const msg = `MeshCore MQTT: timed out before MQTT session (no CONNACK within ${MESHCORE_MQTT_CONNECT_ACK_MS / 1000}s). Check host, port, WebSocket path /mqtt, TLS, and network (firewall, VPN, DNS).`;
      console.error('[MeshcoreMqttAdapter]', sanitizeLogMessage(msg));
      this.emit('error', msg);
      try {
        this.client.removeAllListeners();
        this.client.end(true);
      } catch {
        // catch-no-log-ok forced end during stuck connect
      }
      this.client = null;
      this.setStatus('disconnected');
    }, MESHCORE_MQTT_CONNECT_ACK_MS);
    this.client.on('connect', () => {
      if (this.connectAckTimer) {
        clearTimeout(this.connectAckTimer);
        this.connectAckTimer = null;
      }
      console.debug('[MeshcoreMqttAdapter] CONNACK received', new Date().toISOString());
      this.clientIdStr = this.client?.options?.clientId ?? '';
      this.retryCount = 0;
      this.lastConnected = Date.now();
      this.setStatus('connected');
      this.emit('clientId', this.clientIdStr);
      // Add small delay before resubscribing to allow broker to stabilize
      setTimeout(() => {
        if (this.status !== 'connected' || !this.client) return;
        const base = normalizePrefix(settings.topicPrefix || 'msh');
        const subTopic = `${base}/#`;
        this.client.subscribe(subTopic, (err: Error | null) => {
          if (err) {
            if (this.connectAbortByWatchdog) {
              this.connectAbortByWatchdog = false;
              return;
            }
            // Cascade after transport teardown (e.g. keepalive) — user already got `error`.
            if (/^connection closed$/i.test(err.message.trim())) {
              console.debug(
                '[MeshcoreMqttAdapter] subscribe skipped (connection closed)',
                sanitizeLogMessage(subTopic),
              );
              return;
            }
            const detail = `Subscribe to ${subTopic} failed: ${err.message}`;
            console.warn('[MeshcoreMqttAdapter] subscribe warning', sanitizeLogMessage(detail));
            this.emit('subscribeWarning', detail);
            return;
          }
          console.debug(
            '[MeshcoreMqttAdapter] subscribe callback OK',
            sanitizeLogMessage(subTopic),
          );
        });
      }, 500);
      // Start periodic rescheduling for keepalive
      if (settings.useWebSocket) {
        // Fast ping every 10s to keep LB/proxy connections alive
        this.clearWssPing();
        this.wssPingTimer = setInterval(() => {
          const s = this.client?.stream as { ping?: () => void } | undefined;
          try {
            s?.ping?.();
          } catch {
            // catch-no-log-ok ws ping after teardown
          }
        }, MESHCORE_MQTT_WSS_PING_MS);
        // Also start the 60s reschedule timer
        this.startWssReschedule();
      }
      // Schedule proactive token refresh
      this.scheduleTokenRefresh();
    });
    this.client.on('packetsend', (packet) => {
      if (packet.cmd === 'pingreq') {
        this.pingReqLogged = false;
        console.debug('[MeshcoreMqttAdapter] PINGREQ sent', new Date().toISOString());
      }
    });
    this.client.on('packetreceive', (packet) => {
      if (packet.cmd === 'pingresp') {
        this.pingRespLogged = false;
        console.debug('[MeshcoreMqttAdapter] PINGRESP received', new Date().toISOString());
      }
    });
    this.client.on('message', (topic, payload) => {
      if (!this.firstMessageLogged) {
        this.firstMessageLogged = true;
        console.debug(
          '[MeshcoreMqttAdapter] first message received on topic',
          sanitizeLogMessage(topic),
        );
      }
      const buf = payload instanceof Buffer ? payload : Buffer.from(payload);
      let text = '';
      try {
        text = buf.toString('utf8');
      } catch {
        // catch-no-log-ok invalid UTF-8 buffer — silently skip non-text MQTT payload
        return;
      }
      const env = tryParseMeshcoreMqttChatEnvelope(text.trim());
      if (!env) {
        console.debug('[MeshcoreMqttAdapter] MQTT message not a chat envelope, skipping');
        return;
      }
      this.emit('chatMessage', { topic, ...env });
    });
    this.client.on('error', (err) => {
      this.clearConnectTimers();
      console.error(
        '[MeshcoreMqttAdapter] client error',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      this.emit('error', err instanceof Error ? err.message : String(err));
      // Unblock the UI immediately — 'close' may arrive many seconds later.
      if (this.status === 'connecting') {
        this.setStatus('disconnected');
      }
    });
    this.client.on('close', () => {
      this.clearWssPing();
      this.clearWssReschedule();
      this.clearConnectTimers();
      const now = Date.now();
      this.disconnectCount++;
      const sessionDuration = this.lastConnected ? now - this.lastConnected : 0;
      console.debug(
        `[MeshcoreMqttAdapter] connection closed after ${Math.round(sessionDuration / 1000)}s (disconnect #${this.lastConnected ? this.disconnectCount : 'first'})`,
        new Date().toISOString(),
      );
      const skipReconnect =
        this.status === 'disconnected' || this.status === 'error' || !this.lastSettings;
      if (this.status === 'connected' || this.status === 'connecting') {
        this.setStatus('disconnected');
      }
      if (skipReconnect) return;

      const maxRetries = Math.max(
        1,
        Math.min(
          this.lastSettings!.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS,
          MQTT_MAX_RECONNECT_ATTEMPTS,
        ),
      );
      if (this.retryCount >= maxRetries) {
        this.setError(
          `Connection lost after ${maxRetries} reconnect attempt${maxRetries === 1 ? '' : 's'}`,
        );
        return;
      }

      if (this.needsTokenRefresh()) {
        console.debug('[MeshcoreMqttAdapter] Token stale, emitting refresh event before reconnect');
        this.pendingReconnect = true;
        this.emit(MeshcoreMqttAdapter.EVENT_TOKEN_REFRESH_NEEDED, this.lastSettings?.server ?? '');
        this.pendingReconnectTimer = setTimeout(() => {
          if (this.pendingReconnect && this.lastSettings) {
            console.warn(
              '[MeshcoreMqttAdapter] Token refresh timed out, reconnecting with existing token',
            );
            this.pendingReconnect = false;
            this.pendingReconnectTimer = null;
            this._doConnect(this.lastSettings);
          }
        }, MeshcoreMqttAdapter.PENDING_RECONNECT_TIMEOUT_MS);
        return;
      }

      this.retryCount++;
      const delay =
        this.retryCount === 1
          ? MESHCORE_MQTT_RECONNECT_IMMEDIATE_MS
          : MESHCORE_MQTT_RECONNECT_10_MINUTE_DELAY_MS;
      console.warn(
        `[MeshcoreMqttAdapter] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${maxRetries})`,
      );
      this.setStatus('connecting');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.status !== 'disconnected' && this.lastSettings) {
          this._doConnect(this.lastSettings);
        }
      }, delay);
    });
    this.client.on('offline', () => {
      console.warn('[MeshcoreMqttAdapter] client offline');
      if (this.status === 'connected' || this.status === 'connecting') {
        this.setStatus('disconnected');
      }
    });
  }

  private setStatus(s: MQTTStatus): void {
    this.status = s;
    this.emit('status', s);
  }

  publishChat(envelope: MeshcoreMqttChatEnvelopeV1): void {
    if (!this.client || this.status !== 'connected' || !this.lastSettings) {
      throw new Error('MeshCore MQTT not connected');
    }
    const base = normalizePrefix(this.lastSettings.topicPrefix || 'msh');
    const topic = `${base}/meshcore/chat`;
    const payload = JSON.stringify(envelope);
    this.client.publish(topic, payload, { qos: 0 });
  }

  /**
   * Packet logger / Analyzer feed — same topic layout as meshcoretomqtt (`meshcore/packets` under
   * topic prefix), JSON shape aligned with Andrew-a-g/meshcoretomqtt README examples.
   */
  publishPacketLog(args: { origin: string; snr: number; rssi: number; rawHex?: string }): void {
    if (!this.client || this.status !== 'connected' || !this.lastSettings) {
      throw new Error('MeshCore MQTT not connected');
    }
    const base = normalizePrefix(this.lastSettings.topicPrefix || 'msh');
    const topic = `${base}/meshcore/packets`;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const date = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
    const payload: Record<string, string> = {
      origin: args.origin.slice(0, 200),
      timestamp: now.toISOString(),
      type: 'PACKET',
      direction: 'rx',
      time,
      date,
      SNR: String(args.snr),
      RSSI: String(args.rssi),
      meshclient_source: 'mesh-client',
    };
    if (args.rawHex && args.rawHex.length > 0) {
      payload.raw_hex = args.rawHex.length > 2048 ? args.rawHex.slice(0, 2048) : args.rawHex;
    }
    this.client.publish(topic, JSON.stringify(payload), { qos: 0 });
  }
}
