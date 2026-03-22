import { EventEmitter } from 'events';
import * as mqtt from 'mqtt';

import type { MQTTSettings, MQTTStatus } from '../renderer/lib/types';
import type { MeshcoreMqttChatEnvelopeV1 } from '../shared/meshcoreMqttEnvelope';
import { tryParseMeshcoreMqttChatEnvelope } from '../shared/meshcoreMqttEnvelope';
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
/**
 * MQTT keepalive (seconds) for direct TCP/TLS — standard interval.
 */
const MESHCORE_MQTT_KEEPALIVE_TCP_SEC = 60;
/**
 * MQTT keepalive (seconds) for WSS. mqtt.js fires Keepalive timeout at ~1.5× this value from the
 * last reschedule; shorter values narrow the PINGRESP window (~1.5× keepalive). Idle proxies are
 * kept hot via native WebSocket ping (`MESHCORE_MQTT_WSS_PING_MS`) and `reschedulePing` below.
 */
const MESHCORE_MQTT_KEEPALIVE_WS_SEC = 60;
/** Send WebSocket-level ping frames so LB/proxy idle timers see traffic before the first MQTT PINGREQ. */
const MESHCORE_MQTT_WSS_PING_MS = 25_000;
/**
 * On some WSS paths, wire-level PINGRESP/SUBACK are not observed in time; periodic
 * `reschedulePing(true)` resets mqtt.js KeepaliveManager without relying on inbound ACK callbacks.
 */
const MESHCORE_MQTT_RESCHEDULE_MS = 30_000;

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

  getStatus(): MQTTStatus {
    return this.status;
  }

  getClientId(): string {
    return this.clientIdStr;
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

  /** Reset mqtt.js KeepaliveManager (WSS paths where wire PINGRESP/SUBACK are not observed in time). */
  private startKeepaliveReschedule(): void {
    this.clearKeepaliveReschedule();
    this.keepaliveRescheduleTimer = setInterval(() => {
      if (!this.client?.connected) return;
      try {
        this.client.reschedulePing(true);
      } catch (e) {
        console.debug(
          '[MeshcoreMqttAdapter] reschedulePing failed',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    }, MESHCORE_MQTT_RESCHEDULE_MS);
  }

  disconnect(): void {
    this.clearConnectTimers();
    this.clearWssPing();
    this.clearKeepaliveReschedule();
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
    const clientId = `meshcore-mqtt-${Math.random().toString(36).slice(2, 10)}`;
    const useTls = settings.port === 8883;
    const rejectUnauthorizedTls = useTls ? !settings.tlsInsecure : false;
    const logUrl = buildMeshcoreUrlForLog(settings);

    // Match MQTTManager: WebSocket uses mqtt.connect({ protocol, host, port, path, … }) — not
    // mqtt.connect(urlString, opts), which can hang or mis-handle TLS in Node mqtt.js.
    const keepaliveSec = settings.useWebSocket
      ? MESHCORE_MQTT_KEEPALIVE_WS_SEC
      : MESHCORE_MQTT_KEEPALIVE_TCP_SEC;
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
        protocol: wsScheme as 'wss' | 'ws',
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
      this.clientIdStr = (this.client?.options.clientId as string) || '';
      this.setStatus('connected');
      this.emit('clientId', this.clientIdStr);
      const base = normalizePrefix(settings.topicPrefix || 'msh');
      const subTopic = `${base}/#`;
      this.client!.subscribe(subTopic, (err) => {
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
        console.debug('[MeshcoreMqttAdapter] subscribe callback OK', sanitizeLogMessage(subTopic));
      });
      if (settings.useWebSocket) {
        this.clearWssPing();
        this.wssPingTimer = setInterval(() => {
          const s = this.client?.stream as { ping?: () => void } | undefined;
          try {
            s?.ping?.();
          } catch {
            // catch-no-log-ok ws ping after teardown
          }
        }, MESHCORE_MQTT_WSS_PING_MS);
        this.startKeepaliveReschedule();
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
      if (!env) return;
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
      this.clearKeepaliveReschedule();
      this.clearConnectTimers();
      if (this.status === 'connected' || this.status === 'connecting') {
        this.setStatus('disconnected');
      }
    });
    this.client.on('offline', () => {
      console.warn('[MeshcoreMqttAdapter] client offline');
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
