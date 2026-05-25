import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  Mesh,
  Mqtt,
  Mqtt as MqttProto,
  PaxCount,
  Portnums,
  Telemetry,
} from '@meshtastic/protobufs';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'crypto';
import { EventEmitter } from 'events';
import * as mqtt from 'mqtt';

import type { ChatMessage, MeshNode, MQTTSettings, MQTTStatus } from '../renderer/lib/types';
import { splitChannelPskLine } from '../shared/meshtasticChannelPskLine';
import {
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '../shared/meshtasticMqttReconnect';
import {
  isLikelyReadableChatText,
  resolveMeshtasticTextMessagePayload,
} from '../shared/meshtasticTextMessagePayload';
import { computeMqttReconnectDelayMs } from '../shared/mqttReconnectSchedule';
import {
  formatMeshtasticNodeId,
  meshtasticShortNameAfterClearingDefault,
} from '../shared/nodeNameUtils';
import { MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG } from '../shared/reactionEmoji';
import { sanitizeLogMessage } from './log-service';

const { ServiceEnvelopeSchema } = MqttProto;
const {
  UserSchema,
  PositionSchema,
  DataSchema,
  MeshPacketSchema,
  RoutingSchema,
  RouteDiscoverySchema,
  WaypointSchema,
} = Mesh;
const { PortNum } = Portnums;

// Extended schema constants for additional portnum decoding
const TelemetrySchema =
  (Telemetry as unknown as { TelemetrySchema?: unknown }).TelemetrySchema ?? null;
const PaxcountSchema = (PaxCount as unknown as { PaxcountSchema?: unknown }).PaxcountSchema ?? null;
const MapReportSchema = (Mqtt as unknown as { MapReportSchema?: unknown }).MapReportSchema ?? null;

// Default PSK for meshtastic: 0x01 followed by 15 zero bytes
const DEFAULT_PSK = Buffer.from([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/**
 * Parse a base64-encoded PSK for Meshtastic MQTT (AES-128-CTR or AES-256-CTR).
 * Accepts exactly 16 or 32 decoded bytes; short keys (e.g. "AQ==") zero-pad to 16.
 * Other lengths are rejected (returns null).
 */
export function parsePsk(b64: string): Buffer | null {
  if (!b64.trim()) return null;
  let raw: Buffer;
  try {
    raw = Buffer.from(b64, 'base64');
  } catch {
    // catch-no-log-ok malformed base64 input — caller skips key
    return null;
  }
  if (raw.length === 0) return null;
  if (raw.length === 16 || raw.length === 32) return raw;
  if (raw.length < 16) {
    const out = Buffer.alloc(16, 0);
    raw.copy(out, 0, 0, raw.length);
    return out;
  }
  return null;
}

/** Meshtastic firmware: 16-byte PSK → AES-128-CTR, 32-byte → AES-256-CTR. */
export function cipherForKey(key: Buffer): 'aes-128-ctr' | 'aes-256-ctr' {
  if (key.length === 16) return 'aes-128-ctr';
  if (key.length === 32) return 'aes-256-ctr';
  throw new Error(`Invalid PSK length: ${key.length}`);
}

/** Parse `ChannelName=base64`, `ChannelName@index=base64`, or bare base64 for manual MQTT channel PSK lines. */
export function parseChannelPskLine(
  line: string,
): { name?: string; index?: number; psk: Buffer } | null {
  const split = splitChannelPskLine(line);
  if (!split) return null;
  if (split.kind === 'named') {
    const psk = parsePsk(split.b64);
    if (!psk) return null;
    return { name: split.name, index: split.index, psk };
  }
  const psk = parsePsk(split.b64);
  return psk ? { psk } : null;
}

/** Extract MQTT encrypted topic channel name from `.../2/e/{channelName}/{gatewayId}`. */
export function parseMeshtasticMqttEncryptedTopicChannelName(topic: string): string | undefined {
  const marker = '/2/e/';
  const idx = topic.indexOf(marker);
  if (idx === -1) return undefined;
  const rest = topic.slice(idx + marker.length);
  const slash = rest.indexOf('/');
  const channelName = slash === -1 ? rest : rest.slice(0, slash);
  return channelName.length > 0 ? channelName : undefined;
}

/** Map numeric PortNum to protobuf enum name string (e.g. TEXT_MESSAGE_APP). */
function portNumEnumToProtoName(portnum: number): string {
  const entries = Object.entries(PortNum).filter(([, v]) => typeof v === 'number') as [
    string,
    number,
  ][];
  for (const [name, value] of entries) {
    if (value === portnum) return name;
  }
  return 'UNKNOWN_APP';
}

/**
 * Strip a leading run of 0x00 only (broker padding before JSON `{` or protobuf `0x0a`).
 * Do not strip trailing 0x00 here — a valid ServiceEnvelope can end with a literal 0x00
 * on the wire; trailing padding is removed only after a decode failure (see onMessage).
 */
function trimLeadingNullRun(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start++;
  if (start === 0) return bytes;
  return bytes.subarray(start);
}

/** View `input` as Uint8Array without copying (Node Buffer is Uint8Array-compatible). */
function asUint8Array(input: Buffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/**
 * Leading: strip broker prefix null run (safe).
 * Trailing: do not strip here — a valid ServiceEnvelope can end with a literal 0x00 on the wire;
 * trailing padding is peeled only after decode fails with {@link isIllegalTagFieldZero}.
 */
export function prepareMqttProtobufBytes(input: Buffer | Uint8Array): Uint8Array {
  return trimLeadingNullRun(asUint8Array(input));
}

/** True when protobuf reports illegal tag 0 (typ. trailing 0x00 padding after wire message). */
function isIllegalTagFieldZero(msg: string): boolean {
  return msg.includes('field no 0');
}

// Dedup window: 10 minutes
const DEDUP_TTL_MS = 10 * 60 * 1000;

// Active node cache: prune entries not seen in 24 hours
const NODE_CACHE_PRUNE_MS = 24 * 60 * 60 * 1000;
const NODE_CACHE_MAX_SIZE = 500;

export interface CachedNode {
  node_id: number;
  long_name: string;
  short_name: string;
  hw_model: string;
  last_heard: number;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
}

interface MqttPublishOptions {
  text: string;
  from: number;
  channel: number;
  destination?: number;
  channelName?: string;
  /** Base64 PSK (16 or 32 bytes decoded); overrides channel map when set. */
  pskBase64?: string;
  emoji?: number;
  replyId?: number;
  /** When true, also publish firmware-style JSON on `/2/json/...` (cleartext); only for default public PSK channel. */
  publishJsonMirror: boolean;
}

export interface MqttChannelKeyEntry {
  name: string;
  pskBase64: string;
  index?: number;
}

function coordWarning(lat: number, lon: number): string | null {
  if (lat === 0 && lon === 0) return 'No GPS fix (0°, 0°)';
  if (lat < -90 || lat > 90) return `Latitude out of range: ${lat.toFixed(4)}°`;
  if (lon < -180 || lon > 180) return `Longitude out of range: ${lon.toFixed(4)}°`;
  if (lat === 90 && lon === 0) return 'GPS no fix (reports North Pole)';
  return null;
}

const BROADCAST_ID = 0xffffffff >>> 0;

/** TCP/TLS/WSS + MQTT CONNACK window — shorter than MeshCore so bad brokers fail fast in UI. */
const MESHTASTIC_MQTT_CONNECT_ACK_MS = 12_000;
/** Send WebSocket-level ping frames so LB/proxy idle timers see traffic before the first MQTT PINGREQ. */
const MESHTASTIC_MQTT_WSS_PING_MS = 25_000;
/**
 * Periodic reschedulePing(true) resets mqtt.js KeepaliveManager without waiting for PINGRESP/SUBACK
 * on proxied WSS paths (LetsMesh broker).
 */
const MESHTASTIC_MQTT_RESCHEDULE_MS = 30_000;
const NOISY_DEBUG_LOG_INTERVAL_MS = 60_000;
const BAD_ENVELOPE_SIGNATURE_TTL_MS = 10 * 60 * 1000;

interface SampledDebugLogState {
  lastLoggedAt: number;
  suppressedCount: number;
}

export class MQTTManager extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private status: MQTTStatus = 'disconnected';
  private seenPacketIds = new Map<number, number>(); // packetId → expiry timestamp
  private nodeCache = new Map<number, CachedNode>();
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSettings: MQTTSettings | null = null;
  private clientId = '';
  /** Channel name → PSK (manual connect lines + radio sync via updateChannelKeys). */
  private channelKeysByName = new Map<string, Buffer>();
  /** MQTT topic channel name → RF channel index for inbound message attribution. */
  private channelNameToIndex = new Map<string, number>();
  /** Names registered by the last updateChannelKeys (radio); cleared on next sync. */
  private radioChannelKeyNames = new Set<string>();
  /** Unnamed manual PSKs (decrypt-only brute force). */
  private decryptOnlyPsks: Buffer[] = [];
  /** Deduped keys for tryDecryptAllKeys (DEFAULT_PSK + map values + decrypt-only). */
  private allDecryptKeys: Buffer[] = [DEFAULT_PSK];
  private wssPingTimer: ReturnType<typeof setInterval> | null = null;
  private keepaliveRescheduleTimer: ReturnType<typeof setInterval> | null = null;
  private sampledDebugLogs = new Map<string, SampledDebugLogState>();
  private badEnvelopeSignatures = new Map<string, number>(); // signature -> expiry timestamp
  private static MAX_SAMPLED_LOGS = 1000;
  /** Wall time at start of last `_doConnect` (CONNACK timing in connect logs). */
  private meshtasticConnectT0 = 0;
  /** After `connack timeout`, reconnect with {@link MESHTASTIC_MQTT_RECONNECT_AFTER_CONNACK_TIMEOUT_MS}. */
  private preferFastMqttReconnect = false;
  /** Force-end client if CONNACK never arrives (mqtt.js connectTimeout alone can miss some WSS/TLS hangs). */
  private connectAckTimer: ReturnType<typeof setTimeout> | null = null;

  connect(settings: MQTTSettings): void {
    if (/[+#]/.test(settings.topicPrefix)) {
      throw new Error(
        `MQTT topicPrefix must not contain wildcard characters '+' or '#': ${settings.topicPrefix}`,
      );
    }

    // Disconnect any existing connection first
    this.disconnect();

    this.currentSettings = settings;
    this.channelKeysByName.clear();
    this.channelNameToIndex.clear();
    this.radioChannelKeyNames.clear();
    this.decryptOnlyPsks = [];
    this.applyManualChannelPskLines(settings.channelPsks ?? []);
    this.rebuildAllDecryptKeys();
    this.retryCount = 0;
    this._doConnect(settings);
  }

  /** Merge channel PSKs from connected radio (Android-like); replaces prior radio sync. */
  updateChannelKeys(entries: MqttChannelKeyEntry[]): void {
    for (const name of this.radioChannelKeyNames) {
      this.channelKeysByName.delete(name);
      this.channelNameToIndex.delete(name);
    }
    this.radioChannelKeyNames.clear();
    for (const entry of entries) {
      const name = entry.name.trim();
      const psk = parsePsk(entry.pskBase64);
      if (!name || !psk) continue;
      this.channelKeysByName.set(name, psk);
      this.radioChannelKeyNames.add(name);
      if (entry.index !== undefined && Number.isInteger(entry.index)) {
        const idx = entry.index >>> 0;
        if (idx <= 7) this.channelNameToIndex.set(name, idx);
      }
    }
    this.rebuildAllDecryptKeys();
  }

  private applyManualChannelPskLines(lines: string[]): void {
    for (const line of lines) {
      const parsed = parseChannelPskLine(line);
      if (!parsed) continue;
      if (parsed.name) {
        this.channelKeysByName.set(parsed.name, parsed.psk);
        if (parsed.index !== undefined) {
          const idx = parsed.index >>> 0;
          if (idx <= 7) this.channelNameToIndex.set(parsed.name, idx);
        } else if (parsed.name === 'LongFast') {
          this.channelNameToIndex.set(parsed.name, 0);
        }
      } else {
        this.decryptOnlyPsks.push(parsed.psk);
      }
    }
  }

  private rebuildAllDecryptKeys(): void {
    const seen = new Set<string>();
    const keys: Buffer[] = [];
    const add = (k: Buffer) => {
      const sig = k.toString('base64');
      if (seen.has(sig)) return;
      seen.add(sig);
      keys.push(k);
    };
    add(DEFAULT_PSK);
    for (const k of this.channelKeysByName.values()) add(k);
    for (const k of this.decryptOnlyPsks) add(k);
    this.allDecryptKeys = keys;
  }

  private resolvePskForChannel(channelName: string, explicit?: Buffer): Buffer {
    if (explicit) return explicit;
    return this.channelKeysByName.get(channelName) ?? DEFAULT_PSK;
  }

  private resolveChannelIndexFromTopic(topic: string): number {
    const channelName = parseMeshtasticMqttEncryptedTopicChannelName(topic);
    if (!channelName) return 0;
    const mapped = this.channelNameToIndex.get(channelName);
    if (mapped !== undefined) return mapped;
    if (channelName === 'LongFast') return 0;
    this.logSampledDebug(
      `mqtt-unknown-channel-name:${channelName}`,
      `[Meshtastic MQTT] Unknown topic channel name "${sanitizeLogMessage(channelName)}"; attributing to channel 0`,
    );
    return 0;
  }

  private clearConnectAckTimer(): void {
    if (this.connectAckTimer) {
      clearTimeout(this.connectAckTimer);
      this.connectAckTimer = null;
    }
  }

  private _doConnect(settings: MQTTSettings): void {
    this.clearConnectAckTimer();
    this.setStatus('connecting');
    if (this.client) {
      try {
        this.client.removeAllListeners();
        this.client.end(true);
      } catch {
        // catch-no-log-ok tear down stale client before new connect
      }
      this.client = null;
    }
    const clientId =
      settings.clientId?.trim() || `meshtastic-electron-${randomBytes(3).toString('hex')}`;
    this.clientId = clientId;
    this.meshtasticConnectT0 = Date.now();
    const hostTrim = settings.server.trim();

    const useTls =
      settings.tlsEnabled === true || (settings.tlsEnabled !== false && settings.port === 8883);
    const rejectUnauthorized = useTls ? !settings.tlsInsecure : false;

    const wsEnabled = settings.useWebSocket === true;
    const wsTlsEnabled =
      settings.tlsEnabled === true || (settings.tlsEnabled !== false && settings.port === 443);
    const wsPath = settings.wsPath ?? '/mqtt';
    const wsScheme = wsTlsEnabled ? 'wss' : 'ws';

    const logUrl = wsEnabled
      ? `${wsScheme}://${hostTrim}:${settings.port}${wsPath}`
      : useTls
        ? `mqtts://${hostTrim}:${settings.port}`
        : `mqtt://${hostTrim}:${settings.port}`;
    console.debug('[Meshtastic MQTT] connect start', sanitizeLogMessage(logUrl), 'ws:', wsEnabled); // log-filter-ok Meshtastic MQTT logs → App log panel

    let connectOpts: mqtt.IClientOptions;
    if (wsEnabled) {
      connectOpts = {
        protocol: wsScheme,
        host: hostTrim,
        port: settings.port,
        path: wsPath,
        clientId,
        username: settings.username || undefined,
        password: settings.password || undefined,
        clean: true,
        keepalive: 60,
        connectTimeout: MESHTASTIC_MQTT_CONNECT_ACK_MS,
        reconnectPeriod: 0,
        protocolVersion: 4, // force MQTT 3.1.1; avoids v5 negotiation issues
        rejectUnauthorized,
        // Prefer IPv4 when DNS returns AAAA first but the path is broken (same as MeshcoreMqttAdapter).
        wsOptions: { family: 4 },
      };
      this.client = mqtt.connect(connectOpts);
    } else {
      connectOpts = {
        host: hostTrim,
        port: settings.port,
        protocol: useTls ? 'mqtts' : 'mqtt',
        protocolVersion: 4, // force MQTT 3.1.1; avoids v5 negotiation issues
        clientId,
        username: settings.username || undefined,
        password: settings.password || undefined,
        clean: true,
        keepalive: 60,
        connectTimeout: MESHTASTIC_MQTT_CONNECT_ACK_MS,
        reconnectPeriod: 0,
        rejectUnauthorized,
      };
      this.client = mqtt.connect(connectOpts);
    }

    this.connectAckTimer = setTimeout(() => {
      this.connectAckTimer = null;
      if (this.status !== 'connecting' || !this.client) return;
      const msg = `Meshtastic MQTT: timed out before MQTT session (no CONNACK within ${MESHTASTIC_MQTT_CONNECT_ACK_MS / 1000}s). Check host, port, WebSocket path /mqtt, TLS, and network (firewall, VPN, DNS).`;
      console.error('[Meshtastic MQTT]', sanitizeLogMessage(msg)); // log-filter-ok Meshtastic MQTT logs → App log panel
      this.emit('error', msg);
      this.preferFastMqttReconnect = true;
      try {
        // Do not removeAllListeners — `close` must run so reconnect backoff still schedules.
        this.client.end(true);
      } catch {
        // catch-no-log-ok forced end during stuck connect
      }
    }, MESHTASTIC_MQTT_CONNECT_ACK_MS);

    this.client.on('connect', () => {
      this.clearConnectAckTimer();
      console.debug(
        '[Meshtastic MQTT] CONNACK received',
        `${Date.now() - this.meshtasticConnectT0}ms`,
      ); // log-filter-ok Meshtastic MQTT logs → App log panel
      this.setStatus('connected');
      this.emit('clientId', this.clientId);

      // Guard: only subscribe if still connected
      if (!this.client?.connected) return;

      // Normalize prefix: ensure it ends with "/" before appending the wildcard
      const prefix = settings.topicPrefix.endsWith('/')
        ? settings.topicPrefix
        : `${settings.topicPrefix}/`;
      const topic = `${prefix}#`;
      this.client.subscribe(topic, (err) => {
        if (err) {
          // "Connection closed" is a cascade from a network reset — not fatal,
          // the client will reconnect and resubscribe automatically.
          const isCascade =
            err.message.toLowerCase().includes('connection closed') ||
            err.message.toLowerCase().includes('connection reset');
          if (isCascade) {
            console.warn(
              '[Meshtastic MQTT] Subscribe interrupted (will retry on reconnect):',
              sanitizeLogMessage(err.message),
            );
          } else {
            console.error('[Meshtastic MQTT] Subscribe failed:', sanitizeLogMessage(err.message)); // log-filter-ok Meshtastic MQTT logs → App log panel
            this.setError(`Subscribe failed: ${err.message}`);
          }
        } else {
          // Only reset retry count after a fully stable connection + subscribe
          this.retryCount = 0;
          console.debug('[Meshtastic MQTT] Subscribed to', topic); // log-filter-ok Meshtastic MQTT logs → App log panel
        }
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
        }, MESHTASTIC_MQTT_WSS_PING_MS);
        this.startKeepaliveReschedule();
      }
    });

    this.client.on('message', (topic: string, payload: Buffer | string) => {
      this.onMessage(topic, payload);
    });

    this.client.on('error', (err: Error & { code?: string | number }) => {
      // Transient network errors will trigger 'close' → our backoff handler; don't
      // flip status to "error" for them — that would hide the "connecting" state.
      const code = String(err.code ?? '');
      const isCodeTransient =
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        code === 'ENOTFOUND';
      // mqtt.js emits these with no .code; they're transient broker/proxy conditions.
      const isMsgTransient =
        err.message === 'Keepalive timeout' || err.message === 'connack timeout';
      const isTransient = isCodeTransient || isMsgTransient;
      if (err.message === 'connack timeout') {
        this.preferFastMqttReconnect = true;
      }
      if (isTransient) {
        if (isMsgTransient) {
          console.warn(
            '[Meshtastic MQTT] Connection timeout (will reconnect):',
            sanitizeLogMessage(err.message),
          );
        } else {
          console.warn(
            '[Meshtastic MQTT] Network error (will reconnect):',
            sanitizeLogMessage(err.message),
          ); // log-filter-ok Meshtastic MQTT logs → App log panel
        }
      } else {
        console.error('[Meshtastic MQTT] Fatal connection error:', sanitizeLogMessage(err.message)); // log-filter-ok Meshtastic MQTT logs → App log panel
        this.setError(err.message);
      }
    });

    this.client.on('close', () => {
      this.clearConnectAckTimer();
      this.clearWssPing();
      this.clearKeepaliveReschedule();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      const skipReconnect =
        this.status === 'disconnected' || this.status === 'error' || !this.currentSettings;
      const maxRetries = Math.max(
        1,
        Math.min(
          this.currentSettings?.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS,
          MQTT_MAX_RECONNECT_ATTEMPTS,
        ),
      );
      if (skipReconnect) return;

      if (this.retryCount >= maxRetries) {
        this.setError(
          `Connection lost after ${maxRetries} reconnect attempt${maxRetries === 1 ? '' : 's'}`,
        );
        return;
      }

      this.retryCount++;
      const useFast = this.preferFastMqttReconnect;
      this.preferFastMqttReconnect = false;
      const delay = computeMqttReconnectDelayMs({
        protocol: 'meshtastic',
        attempt: this.retryCount,
        meshtasticConnackFastReconnect: useFast,
      });
      console.warn(
        `[Meshtastic MQTT] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${maxRetries})`,
      ); // log-filter-ok Meshtastic MQTT logs → App log panel
      this.setStatus('disconnected');

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.currentSettings) {
          this._doConnect(this.currentSettings);
        }
      }, delay);
    });

    this.client.on('offline', () => {
      if (this.status === 'disconnected' || this.status === 'error') return;
      if (this.client) {
        this.setStatus('connecting');
      }
    });
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
          '[Meshtastic MQTT] reschedulePing failed',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    }, MESHTASTIC_MQTT_RESCHEDULE_MS);
  }

  /**
   * Publish an encrypted Data payload as a MeshPacket in a ServiceEnvelope.
   * Used by publish(), publishNodeInfo(), publishPosition(), publishWaypoint().
   */
  private publishEncryptedData(
    from: number,
    to: number,
    channel: number,
    channelName: string,
    dataBytes: Uint8Array,
    publishJsonMirror: boolean,
    explicitPsk?: Buffer,
  ): number {
    if (!this.client?.connected || !this.currentSettings) {
      throw new Error('MQTT not connected');
    }
    const packetId = randomInt(0, 0x100000000);
    this.seenPacketIds.set(packetId, Date.now() + DEDUP_TTL_MS);

    const fromId = from >>> 0;
    const toId = to >>> 0;
    const channelId = channel >>> 0;

    const nonce = Buffer.alloc(16, 0);
    nonce.writeUInt32LE(packetId >>> 0, 0);
    nonce.writeUInt32LE(fromId >>> 0, 4);
    const psk = this.resolvePskForChannel(channelName, explicitPsk);
    const cipher = createCipheriv(cipherForKey(psk), psk, nonce);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(dataBytes)), cipher.final()]);

    const packet = create(MeshPacketSchema, {
      from: fromId,
      to: toId,
      id: packetId,
      channel: channelId,
      hopLimit: 3,
      payloadVariant: { case: 'encrypted', value: encrypted },
    });
    const gatewayId = `!${fromId.toString(16).padStart(8, '0')}`;
    const envelope = create(ServiceEnvelopeSchema, {
      packet,
      channelId: channelName,
      gatewayId,
    });
    const prefix = this.currentSettings.topicPrefix.endsWith('/')
      ? this.currentSettings.topicPrefix
      : `${this.currentSettings.topicPrefix}/`;
    const publishTopic = `${prefix}2/e/${channelName}/${gatewayId}`;
    const publishPayload = Buffer.from(toBinary(ServiceEnvelopeSchema, envelope));
    this.logSampledDebug(
      `mqtt-publish:${channelName}`,
      `[Meshtastic MQTT] Publish channel="${sanitizeLogMessage(channelName)}" rf=${channelId} pskBytes=${psk.length} dataBytes=${dataBytes.length} jsonMirror=${publishJsonMirror} encryptedBytes=${encrypted.length} topic="${sanitizeLogMessage(publishTopic)}"`,
    );
    this.client.publish(publishTopic, publishPayload);

    if (publishJsonMirror) {
      try {
        this.publishDecodedJsonMirror(
          fromId,
          toId,
          channelId,
          channelName,
          gatewayId,
          packetId,
          dataBytes,
        );
      } catch (e) {
        console.warn(
          '[Meshtastic MQTT] JSON mirror failed:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    }

    return packetId;
  }

  /**
   * Firmware-style JSON on `/2/json/...` for MQTT monitors (cleartext — gated by publishJsonMirror).
   * Failure point: malformed decoded protobuf — skip mirror only; encrypted uplink already sent.
   */
  private publishDecodedJsonMirror(
    fromId: number,
    toId: number,
    channelId: number,
    channelName: string,
    gatewayId: string,
    packetId: number,
    dataBytes: Uint8Array,
  ): void {
    if (!this.client?.connected || !this.currentSettings) return;

    let rawData;
    try {
      rawData = fromBinary(DataSchema, dataBytes);
    } catch {
      // catch-no-log-ok garbage ciphertext or corrupt Data — skip JSON mirror only
      return;
    }

    const portnum = rawData.portnum ?? PortNum.UNKNOWN_APP;
    const prefix = this.currentSettings.topicPrefix.endsWith('/')
      ? this.currentSettings.topicPrefix
      : `${this.currentSettings.topicPrefix}/`;
    const topicJson = `${prefix}2/json/${channelName}/${gatewayId}`;
    const ts = Math.floor(Date.now() / 1000);

    const body: Record<string, unknown> = {
      id: packetId >>> 0,
      timestamp: ts,
      to: toId >>> 0,
      from: fromId >>> 0,
      channel: channelId >>> 0,
      sender: gatewayId,
      portnum: portNumEnumToProtoName(portnum),
    };

    try {
      if (portnum === PortNum.TEXT_MESSAGE_APP) {
        body.type = 'text';
        const textBytes = rawData.payload ?? new Uint8Array();
        const textStr = new TextDecoder().decode(textBytes);
        let payloadVal: unknown;
        try {
          const parsed: unknown = JSON.parse(textStr);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            payloadVal = parsed;
          } else {
            payloadVal = { text: textStr };
          }
        } catch {
          // catch-no-log-ok payload is plaintext, not JSON — use { text }
          payloadVal = { text: textStr };
        }
        body.payload = payloadVal;
        if (rawData.emoji != null && rawData.emoji !== 0) {
          body.emoji = rawData.emoji;
        }
        if (rawData.replyId != null && rawData.replyId !== 0) {
          body.replyId = rawData.replyId;
        }
      } else if (portnum === PortNum.NODEINFO_APP && rawData.payload?.length) {
        body.type = 'nodeinfo';
        const user = fromBinary(UserSchema, rawData.payload);
        body.payload = {
          id: user.id ?? '',
          longname: user.longName ?? '',
          shortname: user.shortName ?? '',
          hardware: user.hwModel ?? 0,
          role: user.role ?? 0,
        };
      } else if (portnum === PortNum.POSITION_APP && rawData.payload?.length) {
        body.type = 'position';
        const pos = fromBinary(PositionSchema, rawData.payload);
        const p: Record<string, unknown> = {
          latitude_i: pos.latitudeI ?? 0,
          longitude_i: pos.longitudeI ?? 0,
        };
        if (pos.altitude != null) p.altitude = pos.altitude;
        if (pos.time != null) p.time = pos.time;
        body.payload = p;
      } else if (portnum === PortNum.WAYPOINT_APP && rawData.payload?.length) {
        body.type = 'waypoint';
        const wp = fromBinary(WaypointSchema, rawData.payload);
        body.payload = {
          id: wp.id ?? 0,
          name: wp.name ?? '',
          description: wp.description ?? '',
          expire: wp.expire ?? 0,
          locked_to: wp.lockedTo ?? 0,
          latitude_i: wp.latitudeI ?? 0,
          longitude_i: wp.longitudeI ?? 0,
        };
      } else {
        return;
      }

      this.client.publish(topicJson, JSON.stringify(body), { qos: 0 });
    } catch (e) {
      console.warn(
        '[Meshtastic MQTT] JSON mirror encode failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    }
  }

  publish(options: MqttPublishOptions): number {
    const {
      text,
      from,
      channel,
      destination = BROADCAST_ID,
      channelName = 'LongFast',
      pskBase64,
      emoji,
      replyId,
      publishJsonMirror,
    } = options;
    const explicitPsk = pskBase64 ? parsePsk(pskBase64) : undefined;
    if (pskBase64 && !explicitPsk) {
      console.warn(
        '[Meshtastic MQTT] Invalid publish PSK; falling back to channel map or default key',
      );
    }

    const fromId = from >>> 0;
    const destId = destination >>> 0;
    const channelId = channel >>> 0;

    const hasTapback = replyId != null && emoji != null && emoji !== 0;
    const payloadText = hasTapback && text.trim().length === 0 ? String.fromCodePoint(emoji) : text;
    const data = create(DataSchema, {
      portnum: PortNum.TEXT_MESSAGE_APP,
      payload: new TextEncoder().encode(payloadText),
      ...(hasTapback ? { emoji: MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG } : {}),
      ...(replyId ? { replyId } : {}),
    });
    return this.publishEncryptedData(
      fromId,
      destId,
      channelId,
      channelName,
      toBinary(DataSchema, data),
      publishJsonMirror,
      explicitPsk ?? undefined,
    );
  }

  /**
   * Publish a NodeInfo (User) packet to the mesh so other nodes see this client.
   * Broadcasts to all nodes (to = 0xFFFFFFFF). Call periodically when MQTT-only to announce presence.
   */
  publishNodeInfo(
    from: number,
    longName: string,
    shortName: string,
    channelName: string,
    hwModel: number | undefined,
    publishJsonMirror: boolean,
    pskBase64?: string,
  ): number {
    const explicitPsk = pskBase64 ? parsePsk(pskBase64) : undefined;
    const user = create(UserSchema, {
      id: `!${from.toString(16).padStart(8, '0')}`,
      longName,
      shortName,
      ...(hwModel !== undefined ? { hwModel } : {}),
    });
    const data = create(DataSchema, {
      portnum: PortNum.NODEINFO_APP,
      payload: toBinary(UserSchema, user),
    });
    return this.publishEncryptedData(
      from,
      BROADCAST_ID,
      0,
      channelName,
      toBinary(DataSchema, data),
      publishJsonMirror,
      explicitPsk ?? undefined,
    );
  }

  /**
   * Publish a Position packet to the mesh (optional, for map presence).
   * Broadcasts to all nodes. latitudeI/longitudeI are in 1e7 units.
   */
  publishPosition(
    from: number,
    channel: number,
    channelName: string,
    latitudeI: number,
    longitudeI: number,
    altitude: number | undefined,
    publishJsonMirror: boolean,
    pskBase64?: string,
  ): number {
    const explicitPsk = pskBase64 ? parsePsk(pskBase64) : undefined;
    const position = create(PositionSchema, {
      latitudeI,
      longitudeI,
      ...(altitude !== undefined ? { altitude } : {}),
    });
    const data = create(DataSchema, {
      portnum: PortNum.POSITION_APP,
      payload: toBinary(PositionSchema, position),
    });
    return this.publishEncryptedData(
      from,
      BROADCAST_ID,
      channel,
      channelName,
      toBinary(DataSchema, data),
      publishJsonMirror,
      explicitPsk ?? undefined,
    );
  }

  /**
   * Publish a Waypoint packet (WAYPOINT_APP). Typically broadcast.
   */
  publishWaypoint(
    from: number,
    to: number,
    channel: number,
    channelName: string,
    waypoint: {
      id: number;
      latitudeI: number;
      longitudeI: number;
      name: string;
      description?: string;
      icon?: number;
      lockedTo?: number;
      expire?: number;
    },
    publishJsonMirror: boolean,
    pskBase64?: string,
  ): number {
    const explicitPsk = pskBase64 ? parsePsk(pskBase64) : undefined;
    const wp = create(WaypointSchema, {
      id: waypoint.id,
      latitudeI: waypoint.latitudeI,
      longitudeI: waypoint.longitudeI,
      name: waypoint.name,
      description: waypoint.description ?? '',
      icon: waypoint.icon ?? 0,
      lockedTo: waypoint.lockedTo ?? 0,
      expire: waypoint.expire ?? 0,
    });
    const data = create(DataSchema, {
      portnum: PortNum.WAYPOINT_APP,
      payload: toBinary(WaypointSchema, wp),
    });
    return this.publishEncryptedData(
      from >>> 0,
      to >>> 0,
      channel >>> 0,
      channelName,
      toBinary(DataSchema, data),
      publishJsonMirror,
      explicitPsk ?? undefined,
    );
  }

  disconnect(): void {
    this.preferFastMqttReconnect = false;
    this.clearConnectAckTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearWssPing();
    this.clearKeepaliveReschedule();
    this.currentSettings = null;
    this.retryCount = 0;
    if (this.client) {
      this.client.removeAllListeners();
      this.client.end(true);
      this.client = null;
    }
    this.setStatus('disconnected');
  }

  getStatus(): MQTTStatus {
    return this.status;
  }

  getClientId(): string {
    return this.clientId;
  }

  private setStatus(s: MQTTStatus): void {
    this.status = s;
    this.emit('status', s);
  }

  private setError(message: string): void {
    this.status = 'error';
    this.emit('status', 'error');
    this.emit('error', message);
  }

  private isDuplicate(packetId: number): boolean {
    const now = Date.now();
    // Cleanup expired entries occasionally — collect first, then delete to avoid iterator mutation
    if (this.seenPacketIds.size > 10_000) {
      const expired: number[] = [];
      for (const [id, expiry] of this.seenPacketIds) {
        if (expiry < now) expired.push(id);
      }
      for (const id of expired) this.seenPacketIds.delete(id);
    }
    // Hard cap: evict the oldest half of entries rather than wiping all, so dedup history is
    // partially preserved and a flood of unique IDs can't open a replay window.
    if (this.seenPacketIds.size > 50_000) {
      console.warn(
        '[Meshtastic MQTT] seenPacketIds exceeded 50k entries after cleanup — evicting oldest half',
      ); // log-filter-ok Meshtastic MQTT logs → App log panel
      const sorted = [...this.seenPacketIds.entries()].sort((a, b) => a[1] - b[1]);
      const evictCount = sorted.length >> 1;
      for (let i = 0; i < evictCount; i++) this.seenPacketIds.delete(sorted[i][0]);
    }
    if (this.seenPacketIds.has(packetId)) {
      const expiry = this.seenPacketIds.get(packetId)!;
      if (expiry > now) return true;
    }
    this.seenPacketIds.set(packetId, now + DEDUP_TTL_MS);
    return false;
  }

  private pruneNodeCache(): void {
    const now = Date.now();
    const cutoff = now - NODE_CACHE_PRUNE_MS;
    if (this.nodeCache.size <= NODE_CACHE_MAX_SIZE) return;
    for (const [id, node] of this.nodeCache) {
      if (node.last_heard < cutoff) this.nodeCache.delete(id);
    }
  }

  private signatureFromPayload(topic: string, bytes: Uint8Array): string {
    const head = Array.from(bytes.subarray(0, Math.min(24, bytes.length)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const tail = Array.from(bytes.subarray(Math.max(0, bytes.length - 8)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `${topic}|${bytes.length}|${head}|${tail}`;
  }

  private shouldSkipKnownBadEnvelope(topic: string, bytes: Uint8Array): boolean {
    const now = Date.now();
    const key = this.signatureFromPayload(topic, bytes);
    const expiry = this.badEnvelopeSignatures.get(key);
    if (expiry && expiry > now) return true;
    if (expiry && expiry <= now) this.badEnvelopeSignatures.delete(key);
    return false;
  }

  /** Sampled debug key so unrelated decode failures do not share one suppression bucket. */
  private serviceEnvelopeDecodeFailureLogKey(topic: string, bytes: Uint8Array): string {
    const sig = this.signatureFromPayload(topic, bytes);
    const digest8 = createHash('sha256').update(sig, 'utf8').digest('hex').slice(0, 8);
    return `service-envelope-decode-failed|${topic}|${bytes.length}|${digest8}`;
  }

  private rememberBadEnvelope(topic: string, bytes: Uint8Array): void {
    const now = Date.now();
    const key = this.signatureFromPayload(topic, bytes);
    this.badEnvelopeSignatures.set(key, now + BAD_ENVELOPE_SIGNATURE_TTL_MS);
    if (this.badEnvelopeSignatures.size > 1000) {
      for (const [sig, expiry] of this.badEnvelopeSignatures) {
        if (expiry <= now) this.badEnvelopeSignatures.delete(sig);
      }
    }
  }

  private upsertNodeCache(update: Partial<CachedNode> & { node_id: number }): void {
    const { node_id, last_heard = Date.now() } = update;
    const existing = this.nodeCache.get(node_id);
    const merged: CachedNode = {
      node_id,
      long_name: update.long_name ?? existing?.long_name ?? '',
      short_name: update.short_name ?? existing?.short_name ?? '',
      hw_model: update.hw_model ?? existing?.hw_model ?? '',
      last_heard,
      latitude: update.latitude !== undefined ? update.latitude : existing?.latitude,
      longitude: update.longitude !== undefined ? update.longitude : existing?.longitude,
      altitude: update.altitude !== undefined ? update.altitude : existing?.altitude,
    };
    this.nodeCache.set(node_id, merged);
    this.pruneNodeCache();
  }

  getCachedNodes(): CachedNode[] {
    return Array.from(this.nodeCache.values());
  }

  private onMessage(topic: string, payload: Buffer | string): void {
    const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const bytes = prepareMqttProtobufBytes(raw);
    if (bytes.length === 0) return;

    if (bytes[0] === 0x7b) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        this.handleJsonMessage(parsed, topic);
      } catch {
        // catch-no-log-ok non-JSON on topic; failure sampled via logSampledDebug (not parse error object)
        this.logSampledDebug(
          'mqtt-json-parse-failed',
          `[Meshtastic MQTT] JSON parse failed, topic=${sanitizeLogMessage(topic)} bytes=${bytes.length}`,
        );
      }
      return;
    }

    if (bytes[0] !== 0x0a) {
      console.debug(
        `[Meshtastic MQTT] Unknown message format, firstByte=0x${bytes[0].toString(16)} topic=${topic} bytes=${bytes.length}`,
      ); // log-filter-ok Meshtastic MQTT logs → App log panel
      return;
    }

    if (this.shouldSkipKnownBadEnvelope(topic, bytes)) {
      return;
    }

    this.decodeServiceEnvelopeWithTrailingNullRetry(bytes, topic);
  }

  /**
   * Decode ServiceEnvelope; on illegal tag 0 (trailing 0x00 padding), peel trailing nulls and retry.
   * Failure point: corrupt or truncated protobuf on topic. Fallback: sampled log + bad-envelope cache.
   */
  private decodeServiceEnvelopeWithTrailingNullRetry(bytes: Uint8Array, topic: string): void {
    try {
      this.decodeAndHandleServiceEnvelope(bytes, topic);
    } catch (err) {
      let decodeErr: unknown = err;
      let msg = err instanceof Error ? err.message : String(err);
      if (isIllegalTagFieldZero(msg) && bytes.length > 0 && bytes[bytes.length - 1] === 0) {
        let currentBytes = bytes;
        while (currentBytes.length > 0 && currentBytes[currentBytes.length - 1] === 0) {
          currentBytes = currentBytes.subarray(0, currentBytes.length - 1);
          try {
            this.decodeAndHandleServiceEnvelope(currentBytes, topic);
            return;
          } catch (retryErr) {
            // catch-no-log-ok trim-retry expects protobuf errors until trailing nulls removed; final error logged via logSampledDebug below
            decodeErr = retryErr;
            msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            if (!isIllegalTagFieldZero(msg)) break;
          }
        }
      }

      const finalMsg = decodeErr instanceof Error ? decodeErr.message : String(decodeErr);
      this.rememberBadEnvelope(topic, bytes);
      this.logSampledDebug(
        this.serviceEnvelopeDecodeFailureLogKey(topic, bytes),
        `[Meshtastic MQTT] ServiceEnvelope decode failed: ${sanitizeLogMessage(finalMsg)} | Topic: ${sanitizeLogMessage(topic)}`,
      );
    }
  }

  private decodeAndHandleServiceEnvelope(bytes: Uint8Array, topic: string): void {
    const envelope = fromBinary(ServiceEnvelopeSchema, bytes);
    const packet = envelope.packet;
    if (!packet?.from) {
      console.debug(`[Meshtastic MQTT] ServiceEnvelope has no packet.from, topic=${topic}`); // log-filter-ok Meshtastic MQTT logs → App log panel
      return;
    }

    const nodeId = packet.from;
    const packetId = packet.id;

    if (packetId && this.isDuplicate(packetId)) return;

    const hopStart = packet.hopStart ?? 0;
    const hopLimit = packet.hopLimit ?? 0;
    const hopsAway = hopStart > 0 && hopLimit <= hopStart ? hopStart - hopLimit : undefined;

    const payloadCase = packet.payloadVariant?.case;

    if (payloadCase === 'decoded') {
      const decoded = packet.payloadVariant.value as {
        portnum?: number;
        payload?: Uint8Array;
      };
      this.handleDecoded(nodeId, packetId, decoded, hopsAway);
    } else if (payloadCase === 'encrypted') {
      const encrypted = packet.payloadVariant.value;
      const decodedData = this.tryDecryptAllKeys(encrypted, packetId, nodeId, topic);
      if (decodedData) {
        this.handleDecoded(nodeId, packetId, decodedData, hopsAway, topic);
      }
    }
  }

  private handleJsonMessage(parsed: unknown, topic: string): void {
    if (!parsed || typeof parsed !== 'object') return;

    const json = parsed as Record<string, unknown>;

    // Bare nodeinfo-like objects (some gateways): handle before Meshtastic-shape guard.
    if (
      json.longName !== undefined ||
      json.long_name !== undefined ||
      json.shortName !== undefined ||
      json.short_name !== undefined
    ) {
      this.handleJsonNodeInfo(json, topic);
      return;
    }

    const typeRaw = json.type;
    const type = typeof typeRaw === 'string' ? typeRaw.trim() : '';
    const typeLower = type.toLowerCase();

    const portnumRaw = json.portnum;
    const hasMeshtasticShape = typeLower.length > 0 || typeof portnumRaw === 'number';
    if (!hasMeshtasticShape) {
      return;
    }

    if (typeLower === 'nodeinfo' || typeLower === 'user') {
      this.handleJsonNodeInfo(json, topic);
      return;
    }

    if (typeLower === 'position') {
      this.handleJsonPosition(json, topic);
      return;
    }

    if (typeLower === 'telemetry') {
      this.handleJsonTelemetry(json, topic);
      return;
    }

    if (typeLower === 'neighborinfo') {
      this.handleJsonNeighborInfo(json, topic);
      return;
    }

    if (typeLower === 'text') {
      this.handleJsonText(json, topic);
      return;
    }

    if (typeLower === 'traceroute') {
      return;
    }
    if (portnumRaw === PortNum.NODEINFO_APP) {
      this.handleJsonNodeInfo(json, topic);
      return;
    }

    this.logSampledDebug(
      `json-unhandled:${typeLower || 'empty'}:${String(portnumRaw)}`,
      `[Meshtastic MQTT] JSON message unhandled: type="${sanitizeLogMessage(type || '<empty>')}" portnum=${String(portnumRaw)} topic=${sanitizeLogMessage(topic)}`,
    );
  }

  /**
   * Parse a node ID from the "from" field of a JSON MQTT message.
   * Meshtastic firmware may send `from` as a decimal integer, a hex string
   * prefixed with "!" (e.g. "!abcd1234"), or a decimal string.
   * Returns null when the field is missing or unparseable.
   */
  private parseFromNodeId(fromRaw: unknown, handler: string): number | null {
    if (fromRaw == null) {
      console.debug(`[Meshtastic MQTT] JSON ${handler} missing "from" field`); // log-filter-ok Meshtastic MQTT logs → App log panel
      return null;
    }
    if (typeof fromRaw === 'number') {
      return fromRaw >>> 0;
    }
    if (typeof fromRaw !== 'string') {
      console.debug(`[Meshtastic MQTT] JSON ${handler} unexpected from type: ${typeof fromRaw}`); // log-filter-ok Meshtastic MQTT logs → App log panel
      return null;
    }
    const fromStr = fromRaw;
    if (fromStr.startsWith('!')) {
      const nodeId = parseInt(fromStr.slice(1), 16);
      if (isNaN(nodeId)) {
        console.debug(`[Meshtastic MQTT] JSON ${handler} invalid from hex: ${fromStr}`); // log-filter-ok Meshtastic MQTT logs → App log panel
        return null;
      }
      return nodeId >>> 0;
    }
    const nodeId = parseInt(fromStr, 10);
    if (isNaN(nodeId)) {
      console.debug(`[Meshtastic MQTT] JSON ${handler} invalid from: ${fromStr}`); // log-filter-ok Meshtastic MQTT logs → App log panel
      return null;
    }
    return nodeId >>> 0;
  }

  private handleJsonNodeInfo(json: Record<string, unknown>, topic: string): void {
    const nodeId = this.parseFromNodeId(json.from, `nodeinfo topic=${topic}`);
    if (nodeId === null) return;

    const user = json.user as Record<string, unknown> | undefined;
    const payload = json.payload as Record<string, unknown> | undefined;
    // Fall back to the root JSON object when node info fields are at the top level
    // (no "user" or "payload" wrapper) — some firmware versions omit the wrapper.
    const userData = user ?? payload ?? json;

    const longName = (userData.longName ?? userData.long_name ?? userData.longname ?? '') as string;
    const shortName = (userData.shortName ??
      userData.short_name ??
      userData.shortname ??
      '') as string;
    const hwModelNum = userData.hwModel ?? userData.hw_model ?? userData.hardware ?? 0;
    const hwModel = typeof hwModelNum === 'number' ? hwModelNum : 0;
    const role = userData.role as number | undefined;

    const now = Date.now();
    const processedShortName = meshtasticShortNameAfterClearingDefault(longName, shortName, nodeId);

    const nodeUpdate: Partial<MeshNode> & { node_id: number; from_mqtt: boolean } = {
      node_id: nodeId,
      long_name: longName,
      short_name: processedShortName,
      hw_model: String(hwModel),
      ...(role !== undefined && { role }),
      last_heard: now,
      from_mqtt: true,
    };

    this.upsertNodeCache({
      node_id: nodeId,
      long_name: nodeUpdate.long_name,
      short_name: nodeUpdate.short_name,
      hw_model: nodeUpdate.hw_model,
      last_heard: now,
    });

    this.emit('nodeUpdate', nodeUpdate);
  }

  private handleJsonText(json: Record<string, unknown>, topic: string): void {
    const nodeId = this.parseFromNodeId(json.from, `text topic=${topic}`);
    if (nodeId === null) return;

    const jsonPayload = json.payload as Record<string, unknown> | undefined;
    const payloadText = jsonPayload?.text ?? json.text ?? '';
    const text = typeof payloadText === 'string' ? payloadText : '';
    const emojiRaw = jsonPayload?.emoji ?? json.emoji;
    const emoji = typeof emojiRaw === 'number' && emojiRaw !== 0 ? emojiRaw : undefined;
    const replyIdRaw = jsonPayload?.replyId ?? json.replyId;
    const replyId = typeof replyIdRaw === 'number' && replyIdRaw !== 0 ? replyIdRaw : undefined;

    if (!text && !emoji) return;

    if (text) {
      const textBytes = new TextEncoder().encode(text);
      if (!isLikelyReadableChatText(textBytes)) return;
    }

    const packetId = typeof json.id === 'number' ? json.id >>> 0 : 0;
    if (packetId !== 0 && this.isDuplicate(packetId)) return;

    const msg: Omit<ChatMessage, 'id'> & { from_mqtt: boolean } = {
      sender_id: nodeId,
      sender_name: formatMeshtasticNodeId(nodeId),
      payload: text,
      channel: typeof json.channel === 'number' ? json.channel : 0,
      timestamp: typeof json.timestamp === 'number' ? json.timestamp * 1000 : Date.now(),
      packetId,
      from_mqtt: true,
      emoji,
      replyId,
    };
    this.emit('message', msg);
    this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
    this.emitMinimalNodeUpdate(nodeId, undefined, PortNum.TEXT_MESSAGE_APP);
  }

  private handleJsonPosition(json: Record<string, unknown>, topic: string): void {
    const nodeId = this.parseFromNodeId(json.from, `position topic=${topic}`);
    if (nodeId === null) return;

    const jsonPayload = json.payload as Record<string, unknown> | undefined;
    const data = jsonPayload ?? json;

    const latitudeI = (data.latitudeI ?? data.latitude_i) as number | undefined;
    const longitudeI = (data.longitudeI ?? data.longitude_i) as number | undefined;
    const altitude = data.altitude as number | undefined;

    const latRaw = (data.latitude ?? data.lat) as number | undefined;
    const lonRaw = (data.longitude ?? data.lon) as number | undefined;

    let lat: number | undefined;
    let lon: number | undefined;

    if (latitudeI !== undefined && longitudeI !== undefined) {
      lat = latitudeI / 1e7;
      lon = longitudeI / 1e7;
    } else if (latRaw !== undefined && lonRaw !== undefined) {
      lat = latRaw;
      lon = lonRaw;
    }

    if (lat === undefined || lon === undefined) {
      this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
      this.emitMinimalNodeUpdate(nodeId, undefined, PortNum.POSITION_APP);
      return;
    }

    const warning = coordWarning(lat, lon);
    const now = Date.now();

    if (warning) {
      this.upsertNodeCache({ node_id: nodeId, last_heard: now });
      this.emit('nodeUpdate', {
        node_id: nodeId,
        positionWarning: warning,
        last_heard: now,
        from_mqtt: true,
      });
    } else {
      this.upsertNodeCache({
        node_id: nodeId,
        last_heard: now,
        latitude: lat,
        longitude: lon,
        altitude,
      });
      this.emit('nodeUpdate', {
        node_id: nodeId,
        latitude: lat,
        longitude: lon,
        altitude,
        last_heard: now,
        from_mqtt: true,
        positionWarning: null,
      });
    }
  }

  private handleJsonTelemetry(json: Record<string, unknown>, topic: string): void {
    const nodeId = this.parseFromNodeId(json.from, `telemetry topic=${topic}`);
    if (nodeId === null) return;

    const payload = json.payload as Record<string, unknown> | undefined;
    if (!payload) {
      console.debug(
        `[Meshtastic MQTT] JSON telemetry missing payload, nodeId=0x${nodeId.toString(16)}`,
      ); // log-filter-ok
      return;
    }

    const battery_level = payload.battery_level as number | undefined;
    const voltage = payload.voltage as number | undefined;
    const air_util_tx = payload.air_util_tx as number | undefined;
    const channel_utilization = payload.channel_utilization as number | undefined;
    const uptime_seconds = payload.uptime_seconds as number | undefined;

    const now = Date.now();

    this.emit('nodeUpdate', {
      node_id: nodeId,
      battery: battery_level,
      voltage,
      air_util_tx,
      channel_utilization,
      uptime_seconds,
      last_heard: now,
      from_mqtt: true,
    });
  }

  private handleJsonNeighborInfo(json: Record<string, unknown>, topic: string): void {
    const nodeId = this.parseFromNodeId(json.from, `neighborinfo topic=${topic}`);
    if (nodeId === null) return;

    const payload = json.payload as Record<string, unknown> | undefined;
    if (!payload) {
      console.debug(
        `[Meshtastic MQTT] JSON neighborinfo missing payload, nodeId=0x${nodeId.toString(16)}`,
      ); // log-filter-ok
      return;
    }

    const neighbors = payload.neighbors as { node_id: number; snr: number }[] | undefined;
    if (!neighbors) {
      console.debug(
        `[Meshtastic MQTT] JSON neighborinfo missing neighbors array, nodeId=0x${nodeId.toString(16)}`,
      ); // log-filter-ok
      return;
    }

    const now = Date.now();

    // Convert to MeshNeighbor format (camelCase)
    const meshNeighbors = neighbors.map((n) => ({
      nodeId: n.node_id,
      snr: n.snr,
      lastRxTime: now,
    }));

    this.emit('nodeUpdate', {
      node_id: nodeId,
      neighbors: meshNeighbors,
      last_heard: now,
      from_mqtt: true,
    });
  }

  private handleDecoded(
    nodeId: number,
    packetId: number,
    data: { portnum?: number; payload?: Uint8Array; emoji?: number; replyId?: number },
    hopsAway?: number,
    topic?: string,
  ): void {
    const portnum = data.portnum ?? 0;
    const payload = data.payload;

    if (portnum === PortNum.NODEINFO_APP && payload) {
      try {
        const user = fromBinary(UserSchema, payload);
        const now = Date.now();
        const long_name = user.longName || '';
        const short_name = meshtasticShortNameAfterClearingDefault(
          long_name,
          user.shortName || '',
          nodeId,
        );
        const nodeUpdate: Partial<MeshNode> & { node_id: number; from_mqtt: boolean } = {
          node_id: nodeId,
          long_name,
          short_name,
          hw_model: String(user.hwModel ?? ''),
          role: user.role,
          last_heard: now,
          from_mqtt: true,
          ...(hopsAway !== undefined && { hops_away: hopsAway }),
        };
        this.upsertNodeCache({
          node_id: nodeId,
          long_name: nodeUpdate.long_name,
          short_name: nodeUpdate.short_name,
          hw_model: nodeUpdate.hw_model,
          last_heard: now,
        });
        this.emit('nodeUpdate', nodeUpdate);
      } catch (e) {
        console.warn(
          '[Meshtastic MQTT] NodeInfo parse failed for node',
          nodeId,
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
        this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
        this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
      }
    } else if (portnum === PortNum.POSITION_APP && payload) {
      try {
        const pos = fromBinary(PositionSchema, payload);
        const lat = (pos.latitudeI ?? 0) / 1e7;
        const lon = (pos.longitudeI ?? 0) / 1e7;
        const warning = coordWarning(lat, lon);

        if (warning) {
          this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
          this.emit('nodeUpdate', {
            node_id: nodeId,
            positionWarning: warning,
            last_heard: Date.now(),
            from_mqtt: true,
            portnum: PortNum.POSITION_APP,
            ...(hopsAway !== undefined && { hops_away: hopsAway }),
          });
        } else if (pos.latitudeI || pos.longitudeI) {
          const now = Date.now();
          this.upsertNodeCache({
            node_id: nodeId,
            last_heard: now,
            latitude: lat,
            longitude: lon,
            altitude: pos.altitude ?? undefined,
          });
          const nodeUpdate: Partial<MeshNode> & {
            node_id: number;
            from_mqtt: boolean;
            positionWarning: null;
            portnum?: number;
          } = {
            node_id: nodeId,
            latitude: lat,
            longitude: lon,
            altitude: pos.altitude ?? undefined,
            last_heard: now,
            from_mqtt: true,
            positionWarning: null,
            portnum: PortNum.POSITION_APP,
            ...(hopsAway !== undefined && { hops_away: hopsAway }),
          };
          this.emit('nodeUpdate', nodeUpdate);
        } else {
          this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
          this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
        }
      } catch (e) {
        console.warn(
          '[Meshtastic MQTT] Position parse failed for node',
          nodeId,
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
        this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
        this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
      }
    } else if (portnum === PortNum.TEXT_MESSAGE_APP && (payload?.length || data.emoji)) {
      try {
        const payloadBytes = payload ?? new Uint8Array();
        const resolved = resolveMeshtasticTextMessagePayload(payloadBytes);
        if (!resolved) {
          console.debug(
            `[Meshtastic MQTT] Dropped non-readable TEXT_MESSAGE from node ${nodeId} len=${payloadBytes.length}`,
          ); // log-filter-ok Meshtastic MQTT logs → App log panel
          this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
          this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
          return;
        }
        const emoji = data.emoji || undefined;
        const replyId = data.replyId || undefined;
        const msg: Omit<ChatMessage, 'id'> & { from_mqtt: boolean } = {
          sender_id: nodeId,
          sender_name: formatMeshtasticNodeId(nodeId),
          payload: resolved.text,
          channel: topic !== undefined ? this.resolveChannelIndexFromTopic(topic) : 0,
          timestamp: Date.now(),
          packetId,
          from_mqtt: true,
          emoji,
          replyId,
          ...(resolved.viaStoreForward ? { viaStoreForward: true } : {}),
        };
        this.emit('message', msg);
        this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
        this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
      } catch (e) {
        console.warn(
          '[Meshtastic MQTT] TextMessage parse failed for node',
          nodeId,
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
        this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
        this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
      }
    } else if (portnum === PortNum.TELEMETRY_APP && payload) {
      try {
        const telemetry = fromBinary(
          TelemetrySchema as Parameters<typeof fromBinary>[0],
          payload,
        ) as {
          variant?: {
            deviceMetrics?: {
              batteryLevel?: number;
              voltage?: number;
              channelUtilization?: number;
              airUtilTx?: number;
              uptimeSeconds?: number;
            };
          };
        };
        const device = telemetry.variant?.deviceMetrics;
        if (device) {
          this.emit('nodeUpdate', {
            node_id: nodeId,
            battery: device.batteryLevel,
            voltage: device.voltage,
            channel_utilization: device.channelUtilization,
            air_util_tx: device.airUtilTx,
            uptime_seconds: device.uptimeSeconds,
            last_heard: Date.now(),
            from_mqtt: true,
          });
        }
      } catch (e) {
        console.warn(
          '[Meshtastic MQTT] Telemetry parse failed',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    } else if (portnum === PortNum.PAXCOUNTER_APP && payload) {
      try {
        const pax = fromBinary(PaxcountSchema as Parameters<typeof fromBinary>[0], payload) as {
          wifi?: number;
          ble?: number;
        };
        const wifiCount = typeof pax.wifi === 'number' ? pax.wifi : 0;
        const bleCount = typeof pax.ble === 'number' ? pax.ble : 0;
        this.emit('nodeUpdate', {
          node_id: nodeId,
          pax_count: wifiCount + bleCount,
          last_heard: Date.now(),
          from_mqtt: true,
        });
      } catch (e) {
        console.warn(
          '[Meshtastic MQTT] PaxCount parse failed',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    } else if (portnum === PortNum.DETECTION_SENSOR_APP && payload) {
      const text = new TextDecoder().decode(payload);
      this.emit('nodeUpdate', {
        node_id: nodeId,
        detection_text: text,
        last_heard: Date.now(),
        from_mqtt: true,
      });
    } else if (portnum === PortNum.MAP_REPORT_APP && payload) {
      try {
        const report = fromBinary(MapReportSchema as Parameters<typeof fromBinary>[0], payload) as {
          longName?: string;
          shortName?: string;
          hwModel?: unknown;
          role?: unknown;
          latitudeI?: number;
          longitudeI?: number;
        };
        this.emit('nodeUpdate', {
          node_id: nodeId,
          long_name: report.longName ?? undefined,
          short_name: report.shortName ?? undefined,
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          hw_model: report.hwModel != null ? String(report.hwModel) : undefined,
          role: report.role,
          latitude: report.latitudeI ? report.latitudeI / 1e7 : undefined,
          longitude: report.longitudeI ? report.longitudeI / 1e7 : undefined,
          last_heard: Date.now(),
          from_mqtt: true,
        });
      } catch (e) {
        console.warn(
          '[Meshtastic MQTT] MapReport parse failed',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    } else if (portnum === PortNum.ROUTING_APP && payload) {
      try {
        const routing = fromBinary(RoutingSchema as Parameters<typeof fromBinary>[0], payload) as {
          errorReason?: number;
        };
        if (routing.errorReason && routing.errorReason !== 0) {
          console.debug(
            `[Meshtastic MQTT] ROUTING error: nodeId=0x${nodeId.toString(16)} reason=${routing.errorReason}`,
          );
        }
        this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
      } catch {
        // catch-no-log-ok routing is optional info, failures are non-fatal
        this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
      }
    } else if (portnum === PortNum.TRACEROUTE_APP && payload) {
      try {
        const rd = fromBinary(RouteDiscoverySchema, payload) as {
          route?: readonly number[];
          routeBack?: readonly number[];
        };
        this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
        this.emit('traceRouteReply', {
          meshFrom: nodeId,
          route: rd.route != null ? [...rd.route] : [],
          routeBack: rd.routeBack != null ? [...rd.routeBack] : [],
        });
        this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
      } catch (e) {
        console.warn(
          '[Meshtastic MQTT] TRACEROUTE RouteDiscovery parse failed',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
        this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
        this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
      }
    } else {
      // Unknown portnum — at least track the node as seen
      this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
      this.emitMinimalNodeUpdate(nodeId, hopsAway, portnum);
    }
  }

  private emitMinimalNodeUpdate(nodeId: number, hopsAway?: number, portnum?: number): void {
    const cached = this.nodeCache.get(nodeId);
    this.emit('nodeUpdate', {
      node_id: nodeId,
      last_heard: Date.now(),
      from_mqtt: true,
      ...(cached?.long_name && { long_name: cached.long_name }),
      ...(cached?.short_name && { short_name: cached.short_name }),
      ...(cached?.hw_model && { hw_model: cached.hw_model }),
      ...(hopsAway !== undefined && { hops_away: hopsAway }),
      ...(portnum !== undefined && { portnum }),
    });
  }

  /**
   * Attempt AES-CTR decryption with a specific key (128- or 256-bit per key length).
   * Returns raw bytes on success, null if the crypto operation itself fails (e.g. bad key length).
   * Note: AES-CTR always "succeeds" cryptographically — a wrong key just produces garbage bytes.
   * Use tryDecryptAllKeys to validate by attempting protobuf decode across all known keys.
   */
  private tryDecryptWithKey(
    encrypted: Uint8Array,
    packetId: number,
    from: number,
    key: Buffer,
  ): Buffer | null {
    try {
      const nonce = Buffer.alloc(16, 0);
      nonce.writeUInt32LE(packetId >>> 0, 0);
      nonce.writeUInt32LE(from >>> 0, 4);
      const decipher = createDecipheriv(cipherForKey(key), key, nonce);
      return Buffer.concat([decipher.update(Buffer.from(encrypted)), decipher.final()]);
    } catch {
      // catch-no-log-ok AES decrypt failed with this key — caller tries next key
      return null;
    }
  }

  /**
   * Try decrypting with all known PSKs (default, named channels, manual extras).
   * Validates each decryption attempt by parsing the result as a DataSchema protobuf.
   * Returns the decoded Data message if any key succeeds, null if all fail.
   */
  private tryDecryptAllKeys(
    encrypted: Uint8Array,
    packetId: number,
    from: number,
    topic?: string,
  ): { portnum?: number; payload?: Uint8Array; emoji?: number; replyId?: number } | null {
    const allKeys = this.allDecryptKeys;
    for (const key of allKeys) {
      const raw = this.tryDecryptWithKey(encrypted, packetId, from, key);
      if (!raw) continue;
      try {
        return fromBinary(DataSchema, raw);
      } catch {
        // catch-no-log-ok wrong PSK produces garbage bytes that fail protobuf decode — try next key
      }
    }
    if (topic) {
      const channelName = parseMeshtasticMqttEncryptedTopicChannelName(topic) ?? 'unknown';
      this.logSampledDebug(
        `mqtt-decrypt-failed:${channelName}`,
        `[Meshtastic MQTT] Decrypt failed for topic channel "${sanitizeLogMessage(channelName)}" (${allKeys.length} keys tried)`,
      );
    }
    return null;
  }

  private logSampledDebug(
    key: string,
    message: string,
    intervalMs = NOISY_DEBUG_LOG_INTERVAL_MS,
  ): void {
    const now = Date.now();
    const state = this.sampledDebugLogs.get(key);
    if (!state) {
      this.pruneSampledLogs();
      this.sampledDebugLogs.set(key, { lastLoggedAt: now, suppressedCount: 0 });
      console.debug(message); // log-filter-ok Meshtastic MQTT logs → App log panel
      return;
    }

    if (now - state.lastLoggedAt >= intervalMs) {
      const suffix =
        state.suppressedCount > 0
          ? ` (suppressed ${state.suppressedCount} similar message${state.suppressedCount === 1 ? '' : 's'})`
          : '';
      console.debug(`${message}${suffix}`); // log-filter-ok Meshtastic MQTT logs → App log panel
      state.lastLoggedAt = now;
      state.suppressedCount = 0;
      return;
    }

    state.suppressedCount += 1;
  }

  private pruneSampledLogs(): void {
    while (this.sampledDebugLogs.size > MQTTManager.MAX_SAMPLED_LOGS) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [k, v] of this.sampledDebugLogs) {
        if (v.lastLoggedAt < oldestTime) {
          oldestTime = v.lastLoggedAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.sampledDebugLogs.delete(oldestKey);
      else break;
    }
  }
}
