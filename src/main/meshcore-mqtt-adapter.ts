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
/** Reconnect delay base/cap — mirrors MQTTManager. */
const MESHCORE_MQTT_RECONNECT_IMMEDIATE_MS = 500;
const MESHCORE_MQTT_RECONNECT_10_MINUTE_DELAY_MS = 600_000;
/**
 * Periodic reschedulePing(true) resets mqtt.js KeepaliveManager without waiting for PINGRESP/SUBACK
 * on proxied WSS paths (LetsMesh broker) — same as MQTTManager.
 */
const MESHCORE_MQTT_RESCHEDULE_MS = 30_000;
/**
 * A session that lasted this long is considered stable. When the next disconnect occurs after a
 * stable session, retryCount resets to 0 so the full retry budget is available again.
 */
const MESHCORE_MQTT_CONNECTION_STABLE_THRESHOLD_MS = 30_000;

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
  private keepaliveRescheduleTimer: ReturnType<typeof setInterval> | null = null;
  private pingReqLogged = false;
  private pingRespLogged = false;
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
  /**
   * Safety timeout: if renderer never responds to token refresh request, reconnect anyway.
   * 15s to allow for cold dynamic-import of @michaelhart/meshcore-decoder in the renderer.
   */
  private static readonly PENDING_RECONNECT_TIMEOUT_MS = 15_000;

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
      console.debug('[MeshCore MQTT] Token updated, triggering pending reconnect');
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
        '[MeshCore MQTT] token already within grace period, skipping proactive refresh schedule',
      );
      return;
    }
    console.debug(
      '[MeshCore MQTT] scheduling proactive token refresh',
      `in ${Math.round(scheduleMs / 1000 / 60)}min (expires in ${Math.round(timeUntilExpiry / 1000 / 60)}min)`,
    );
    this.tokenRefreshTimer = setTimeout(() => {
      if (this.status !== 'connected' || !this.lastSettings) return;
      console.debug('[MeshCore MQTT] proactive token refresh fired');
      this.emit(MeshcoreMqttAdapter.EVENT_PROACTIVE_TOKEN_REFRESH, this.lastSettings.server);
    }, scheduleMs);
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

  private clearKeepaliveReschedule(): void {
    if (this.keepaliveRescheduleTimer) {
      clearInterval(this.keepaliveRescheduleTimer);
      this.keepaliveRescheduleTimer = null;
    }
  }

  private startKeepaliveReschedule(): void {
    this.clearKeepaliveReschedule();
    this.keepaliveRescheduleTimer = setInterval(() => {
      if (!this.client?.connected) return;
      try {
        this.client.reschedulePing(true);
      } catch (e) {
        console.debug(
          '[MeshCore MQTT] reschedulePing failed',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    }, MESHCORE_MQTT_RESCHEDULE_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    this.clearKeepaliveReschedule();
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
          '[MeshCore MQTT] disconnect',
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
    // Clear any stale connectAckTimer from a previous _doConnect call so the old watchdog
    // cannot tear down the new client 30s later (Bug 3 fix).
    this.clearConnectTimers();
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
    // Use MQTT keepalive for both WebSocket and raw TCP; letsmesh requires PINGREQ every 60s.
    // WebSocket-level pings (MESHCORE_MQTT_WSS_PING_MS) additionally keep LB/proxy paths alive.
    const keepaliveSec = settings.keepalive ?? 60;
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
      '[MeshCore MQTT] connect start',
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
      console.error('[MeshCore MQTT]', sanitizeLogMessage(msg));
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
      // retryCount is NOT reset here — it resets only after a stable session (>= 30s) in the
      // close handler. Resetting on CONNACK alone caused perpetual "attempt 1/N" loops because
      // some brokers (LetsMesh) send CONNACK(0) then validate JWT asynchronously and close
      // immediately, causing retryCount to reset on every cycle.
      console.debug(
        '[MeshCore MQTT] CONNACK received',
        new Date().toISOString(),
        `retryCount=${this.retryCount}`,
      );
      this.clientIdStr = this.client?.options?.clientId ?? '';
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
                '[MeshCore MQTT] subscribe skipped (connection closed)',
                sanitizeLogMessage(subTopic),
              );
              return;
            }
            const detail = `Subscribe to ${subTopic} failed: ${err.message}`;
            console.warn('[MeshCore MQTT] subscribe warning', sanitizeLogMessage(detail));
            this.emit('subscribeWarning', detail);
            return;
          }
          console.debug('[MeshCore MQTT] subscribe callback OK', sanitizeLogMessage(subTopic));
        });
      }, 500);
      // WebSocket-level pings keep LB/proxy paths alive independent of MQTT keepalive
      if (settings.useWebSocket) {
        // Ping every 10s so intermediary idle timers stay reset
        this.clearWssPing();
        this.wssPingTimer = setInterval(() => {
          const s = this.client?.stream as { ping?: () => void } | undefined;
          try {
            s?.ping?.();
          } catch {
            // catch-no-log-ok ws ping after teardown
          }
        }, MESHCORE_MQTT_WSS_PING_MS);
      }
      // Start keepalive reschedule (same as MQTTManager) — resets mqtt.js keepalive without waiting for PINGRESP
      this.startKeepaliveReschedule();
      // Schedule proactive token refresh
      this.scheduleTokenRefresh();
    });
    this.client.on('packetsend', (packet) => {
      if (packet.cmd === 'pingreq') {
        this.pingReqLogged = false;
        console.debug('[MeshCore MQTT] PINGREQ sent', new Date().toISOString());
      }
    });
    this.client.on('packetreceive', (packet) => {
      if (packet.cmd === 'pingresp') {
        this.pingRespLogged = false;
        console.debug('[MeshCore MQTT] PINGRESP received', new Date().toISOString());
      }
    });
    this.client.on('message', (topic, payload) => {
      if (!this.firstMessageLogged) {
        this.firstMessageLogged = true;
        console.debug('[MeshCore MQTT] first message received on topic', sanitizeLogMessage(topic));
      }
      const buf = payload instanceof Buffer ? payload : Buffer.from(payload);
      let text: string;
      try {
        text = buf.toString('utf8');
      } catch {
        // catch-no-log-ok invalid UTF-8 buffer — silently skip non-text MQTT payload
        return;
      }
      const env = tryParseMeshcoreMqttChatEnvelope(text.trim());
      if (!env) {
        console.debug('[MeshCore MQTT] MQTT message not a chat envelope, skipping');
        return;
      }
      this.emit('chatMessage', { topic, ...env });
    });
    this.client.on('error', (err) => {
      this.clearConnectTimers();
      console.error(
        '[MeshCore MQTT] client error',
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
      this.clearKeepaliveReschedule();
      this.clearConnectTimers();
      const now = Date.now();
      this.disconnectCount++;
      const sessionDuration = this.lastConnected ? now - this.lastConnected : 0;
      console.debug(
        `[MeshCore MQTT] connection closed after ${Math.round(sessionDuration / 1000)}s (disconnect #${this.lastConnected ? this.disconnectCount : 'first'})`,
        new Date().toISOString(),
      );
      const skipReconnect =
        this.status === 'disconnected' || this.status === 'error' || !this.lastSettings;
      if (this.status === 'connected' || this.status === 'connecting') {
        this.setStatus('disconnected');
      }
      if (skipReconnect) return;

      // Bug 1b fix: reset retry budget only when the session was genuinely stable (>= 30s).
      // Resetting on CONNACK alone allowed brokers that send CONNACK then immediately drop
      // (e.g. async JWT validation) to trap the adapter in a perpetual "attempt 1/N" loop.
      const isStableSession = sessionDuration >= MESHCORE_MQTT_CONNECTION_STABLE_THRESHOLD_MS;
      if (isStableSession) {
        this.retryCount = 0;
      }

      const maxRetries = Math.max(
        1,
        Math.min(
          this.lastSettings!.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS,
          MQTT_MAX_RECONNECT_ATTEMPTS,
        ),
      );

      // Bug 4 fix: increment retryCount BEFORE the token-refresh branch so that the max-retry
      // guard fires even when we always enter the refresh path (JWT brokers).
      this.retryCount++;

      const isJwtBroker = !!this.lastSettings?.tokenExpiresAt;
      console.debug(
        `[MeshCore MQTT] close: session=${Math.round(sessionDuration / 1000)}s stable=${isStableSession} attempt=${this.retryCount}/${maxRetries} jwtBroker=${isJwtBroker}`,
      );

      if (this.retryCount > maxRetries) {
        this.setError(
          `Connection lost after ${maxRetries} reconnect attempt${maxRetries === 1 ? '' : 's'}`,
        );
        return;
      }

      // Bug 2 fix: for JWT-auth brokers (tokenExpiresAt set) always request a fresh token before
      // reconnecting — not only when within the 5-min grace window. meshcoretomqtt generates a
      // new token on every reconnect; reusing a stale/rejected token on every attempt is the
      // second cause of the infinite reconnect loop.
      if (isJwtBroker) {
        console.debug('[MeshCore MQTT] JWT broker: requesting fresh token before reconnect');
        this.pendingReconnect = true;
        this.emit(MeshcoreMqttAdapter.EVENT_TOKEN_REFRESH_NEEDED, this.lastSettings?.server ?? '');
        this.pendingReconnectTimer = setTimeout(() => {
          if (this.pendingReconnect && this.lastSettings) {
            console.warn(
              '[MeshCore MQTT] Token refresh timed out, reconnecting with existing token',
            );
            this.pendingReconnect = false;
            this.pendingReconnectTimer = null;
            this._doConnect(this.lastSettings);
          }
        }, MeshcoreMqttAdapter.PENDING_RECONNECT_TIMEOUT_MS);
        return;
      }

      // Bug 6 fix: add jitter to the first reconnect to avoid thundering herd on broker restart.
      const jitterMs = Math.floor(Math.random() * 2000);
      const delay =
        this.retryCount === 1
          ? MESHCORE_MQTT_RECONNECT_IMMEDIATE_MS + jitterMs
          : MESHCORE_MQTT_RECONNECT_10_MINUTE_DELAY_MS;
      console.warn(
        `[MeshCore MQTT] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${maxRetries})`,
      );
      this.setStatus('connecting');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        // Bug 5 fix: check status === 'connecting', not !== 'disconnected', so a manual
        // connect() call during the window does not trigger a second _doConnect().
        if (this.status === 'connecting' && this.lastSettings) {
          this._doConnect(this.lastSettings);
        }
      }, delay);
    });
    this.client.on('offline', () => {
      console.warn('[MeshCore MQTT] client offline');
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
