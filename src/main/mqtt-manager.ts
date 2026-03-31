import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { Mesh, Mqtt as MqttProto, Portnums } from '@meshtastic/protobufs';
import { createCipheriv, createDecipheriv } from 'crypto';
import { EventEmitter } from 'events';
import * as mqtt from 'mqtt';

import type { ChatMessage, MeshNode, MQTTSettings, MQTTStatus } from '../renderer/lib/types';
import {
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '../shared/meshtasticMqttReconnect';
import { meshtasticShortNameAfterClearingDefault } from '../shared/nodeNameUtils';
import { sanitizeLogMessage } from './log-service';

const { ServiceEnvelopeSchema } = MqttProto;
const { UserSchema, PositionSchema, DataSchema, MeshPacketSchema } = Mesh;
const { PortNum } = Portnums;

// Default PSK for meshtastic: 0x01 followed by 15 zero bytes
const DEFAULT_PSK = Buffer.from([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/**
 * Parse a base64-encoded PSK string into a 16-byte AES-128 key.
 * Short keys (e.g. "AQ==" = 1 byte) are zero-padded to 16 bytes.
 * Keys longer than 16 bytes are truncated.
 * Empty strings are rejected (returns null).
 */
export function parsePsk(b64: string): Buffer | null {
  if (!b64.trim()) return null;
  const raw = Buffer.from(b64, 'base64');
  if (raw.length === 0) return null;
  if (raw.length === 16) return raw;
  const out = Buffer.alloc(16, 0);
  raw.copy(out, 0, 0, Math.min(raw.length, 16));
  return out;
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
  emoji?: number;
  replyId?: number;
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
/** Reconnect delay after `close`: 0.5s → 1s → 2s → … capped (was 2s base, 60s cap). */
const MESHTASTIC_MQTT_RECONNECT_BACKOFF_BASE_MS = 500;
const MESHTASTIC_MQTT_RECONNECT_BACKOFF_CAP_MS = 8_000;
/** After `connack timeout`, next attempt starts quickly instead of waiting for backoff. */
const MESHTASTIC_MQTT_RECONNECT_AFTER_CONNACK_TIMEOUT_MS = 250;
/** Send WebSocket-level ping frames so LB/proxy idle timers see traffic before the first MQTT PINGREQ. */
const MESHTASTIC_MQTT_WSS_PING_MS = 25_000;
/**
 * Periodic reschedulePing(true) resets mqtt.js KeepaliveManager without waiting for PINGRESP/SUBACK
 * on proxied WSS paths (LetsMesh broker).
 */
const MESHTASTIC_MQTT_RESCHEDULE_MS = 30_000;

export class MQTTManager extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private status: MQTTStatus = 'disconnected';
  private seenPacketIds = new Map<number, number>(); // packetId → expiry timestamp
  private nodeCache = new Map<number, CachedNode>();
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSettings: MQTTSettings | null = null;
  private clientId = '';
  /** Parsed additional PSKs from settings.channelPsks, tried after DEFAULT_PSK. */
  private extraPsks: Buffer[] = [];
  private wssPingTimer: ReturnType<typeof setInterval> | null = null;
  private keepaliveRescheduleTimer: ReturnType<typeof setInterval> | null = null;
  /** Wall time at start of last `_doConnect` (CONNACK timing in connect logs). */
  private meshtasticConnectT0 = 0;
  /** After `connack timeout`, reconnect with {@link MESHTASTIC_MQTT_RECONNECT_AFTER_CONNACK_TIMEOUT_MS}. */
  private preferFastMqttReconnect = false;

  connect(settings: MQTTSettings): void {
    // Disconnect any existing connection first
    this.disconnect();

    this.currentSettings = settings;
    this.extraPsks = (settings.channelPsks ?? [])
      .map(parsePsk)
      .filter((k): k is Buffer => k !== null);
    this.retryCount = 0;
    this.setStatus('connecting');
    this._doConnect(settings);
  }

  private _doConnect(settings: MQTTSettings): void {
    this.clientId = `meshtastic-electron-${Math.random().toString(36).slice(2, 8)}`;
    const clientId = this.clientId;
    this.meshtasticConnectT0 = Date.now();
    const hostTrim = settings.server.trim();

    // Port 8883 is the conventional MQTT-over-TLS port: use mqtts and verify certs unless tlsInsecure is set.
    const useTls = settings.port === 8883;
    const rejectUnauthorized = useTls ? !settings.tlsInsecure : false;

    const logUrl = settings.useWebSocket
      ? `${settings.port === 443 || settings.tlsInsecure !== true ? 'wss' : 'ws'}://${hostTrim}:${settings.port}/mqtt`
      : useTls
        ? `mqtts://${hostTrim}:${settings.port}`
        : `mqtt://${hostTrim}:${settings.port}`;
    console.debug(
      '[MQTT] connect start',
      sanitizeLogMessage(logUrl),
      'ws:',
      settings.useWebSocket === true,
    );

    let connectOpts: mqtt.IClientOptions;
    if (settings.useWebSocket) {
      const wsScheme = settings.port === 443 || settings.tlsInsecure !== true ? 'wss' : 'ws';
      connectOpts = {
        protocol: wsScheme,
        host: hostTrim,
        port: settings.port,
        path: '/mqtt',
        clientId,
        username: settings.username || undefined,
        password: settings.password || undefined,
        clean: true,
        keepalive: 60,
        connectTimeout: MESHTASTIC_MQTT_CONNECT_ACK_MS,
        reconnectPeriod: 0,
        protocolVersion: 4, // force MQTT 3.1.1; avoids v5 negotiation issues
        rejectUnauthorized: settings.port === 443 ? true : rejectUnauthorized,
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

    this.client.on('connect', () => {
      console.debug('[MQTT] CONNACK received', `${Date.now() - this.meshtasticConnectT0}ms`); // log-filter-ok Meshtastic MQTT logs → App log panel
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
              '[MQTT] Subscribe interrupted (will retry on reconnect):',
              sanitizeLogMessage(err.message),
            );
          } else {
            console.error('[MQTT] Subscribe failed:', sanitizeLogMessage(err.message)); // log-filter-ok Meshtastic MQTT logs → App log panel
            this.setError(`Subscribe failed: ${err.message}`);
          }
        } else {
          // Only reset retry count after a fully stable connection + subscribe
          this.retryCount = 0;
          console.debug('[MQTT] Subscribed to', topic); // log-filter-ok Meshtastic MQTT logs → App log panel
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
            '[MQTT] Connection timeout (will reconnect):',
            sanitizeLogMessage(err.message),
          );
        } else {
          console.warn('[MQTT] Network error (will reconnect):', sanitizeLogMessage(err.message)); // log-filter-ok Meshtastic MQTT logs → App log panel
        }
      } else {
        console.error('[MQTT] Fatal connection error:', sanitizeLogMessage(err.message)); // log-filter-ok Meshtastic MQTT logs → App log panel
        this.setError(err.message);
      }
    });

    this.client.on('close', () => {
      this.clearWssPing();
      this.clearKeepaliveReschedule();
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
      const backoff = Math.min(
        MESHTASTIC_MQTT_RECONNECT_BACKOFF_BASE_MS * Math.pow(2, this.retryCount - 1),
        MESHTASTIC_MQTT_RECONNECT_BACKOFF_CAP_MS,
      );
      const useFast = this.preferFastMqttReconnect;
      this.preferFastMqttReconnect = false;
      const delay = useFast ? MESHTASTIC_MQTT_RECONNECT_AFTER_CONNACK_TIMEOUT_MS : backoff;
      console.warn(`[MQTT] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${maxRetries})`); // log-filter-ok Meshtastic MQTT logs → App log panel
      this.setStatus('connecting');

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.status !== 'disconnected' && this.currentSettings) {
          this._doConnect(this.currentSettings);
        }
      }, delay);
    });

    this.client.on('offline', () => {
      if (this.status !== 'disconnected') {
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
          '[MQTT] reschedulePing failed',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    }, MESHTASTIC_MQTT_RESCHEDULE_MS);
  }

  /**
   * Publish an encrypted Data payload as a MeshPacket in a ServiceEnvelope.
   * Used by publish(), publishNodeInfo(), and publishPosition().
   */
  private publishEncryptedData(
    from: number,
    to: number,
    channel: number,
    channelName: string,
    dataBytes: Uint8Array,
  ): number {
    if (!this.client?.connected || !this.currentSettings) {
      throw new Error('MQTT not connected');
    }
    const packetId = (Math.random() * 0xffffffff) >>> 0;
    this.seenPacketIds.set(packetId, Date.now() + DEDUP_TTL_MS);

    const fromId = from >>> 0;
    const toId = to >>> 0;
    const channelId = channel >>> 0;

    const nonce = Buffer.alloc(16, 0);
    nonce.writeUInt32LE(packetId >>> 0, 0);
    nonce.writeUInt32LE(fromId >>> 0, 4);
    const cipher = createCipheriv('aes-128-ctr', DEFAULT_PSK, nonce);
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
    this.client.publish(
      `${prefix}2/e/${channelName}/${gatewayId}`,
      Buffer.from(toBinary(ServiceEnvelopeSchema, envelope)),
    );
    return packetId;
  }

  publish(options: MqttPublishOptions): number {
    const {
      text,
      from,
      channel,
      destination = BROADCAST_ID,
      channelName = 'LongFast',
      emoji,
      replyId,
    } = options;

    const fromId = from >>> 0;
    const destId = destination >>> 0;
    const channelId = channel >>> 0;

    const data = create(DataSchema, {
      portnum: PortNum.TEXT_MESSAGE_APP,
      payload: new TextEncoder().encode(text),
      ...(emoji ? { emoji } : {}),
      ...(replyId ? { replyId } : {}),
    });
    return this.publishEncryptedData(
      fromId,
      destId,
      channelId,
      channelName,
      toBinary(DataSchema, data),
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
    hwModel?: number,
  ): number {
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
    altitude?: number,
  ): number {
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
    );
  }

  disconnect(): void {
    this.preferFastMqttReconnect = false;
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
    // Hard cap: if the map is still very large after cleanup, clear it entirely to prevent
    // unbounded memory growth from a malicious or misbehaving broker.
    if (this.seenPacketIds.size > 50_000) {
      console.warn('[MQTT] seenPacketIds exceeded 50k entries after cleanup — clearing dedup map'); // log-filter-ok Meshtastic MQTT logs → App log panel
      this.seenPacketIds.clear();
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
    const cleanBytes = new Uint8Array(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
    if (cleanBytes.length === 0) return;

    if (cleanBytes[0] === 0x7b) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(cleanBytes));
        this.handleJsonMessage(parsed, topic);
      } catch {
        console.debug(
          '[MQTT] non-JSON payload ignored, topic=%s bytes=%d',
          topic,
          cleanBytes.length,
        );
      }
      return;
    }

    if (cleanBytes[0] !== 0x0a) return;

    try {
      const envelope = fromBinary(ServiceEnvelopeSchema, cleanBytes);
      const packet = envelope.packet;
      if (!packet?.from) return;

      const nodeId = packet.from;
      const packetId = packet.id;

      if (packetId && this.isDuplicate(packetId)) return;

      const payloadCase = packet.payloadVariant?.case;

      if (payloadCase === 'decoded') {
        const decoded = packet.payloadVariant.value as {
          portnum?: number;
          payload?: Uint8Array;
        };
        this.handleDecoded(nodeId, packetId, decoded);
      } else if (payloadCase === 'encrypted') {
        const encrypted = packet.payloadVariant.value;
        const decodedData = this.tryDecryptAllKeys(encrypted, packetId, nodeId);
        if (decodedData) {
          this.handleDecoded(nodeId, packetId, decodedData);
        } else {
          this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
          this.emitMinimalNodeUpdate(nodeId);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Public msh/# feeds carry JSON, corrupt, or non-Meshtastic binary; first byte 0x0a is not
      // sufficient proof of ServiceEnvelope. Debug only — avoids dual-mode log spam.
      console.debug(
        '[MQTT] ServiceEnvelope decode failed:',
        sanitizeLogMessage(msg),
        '| Topic:',
        sanitizeLogMessage(topic),
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- JSON path; params reserved for future routing
  private handleJsonMessage(_parsed: unknown, _topic: string): void {
    // Silent: JSON messages handled without logging
  }

  private handleDecoded(
    nodeId: number,
    packetId: number,
    data: { portnum?: number; payload?: Uint8Array; emoji?: number; replyId?: number },
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
          '[MQTT] NodeInfo parse failed for node',
          nodeId,
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
        this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
        this.emitMinimalNodeUpdate(nodeId);
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
          } = {
            node_id: nodeId,
            latitude: lat,
            longitude: lon,
            altitude: pos.altitude ?? undefined,
            last_heard: now,
            from_mqtt: true,
            positionWarning: null,
          };
          this.emit('nodeUpdate', nodeUpdate);
        } else {
          this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
          this.emitMinimalNodeUpdate(nodeId);
        }
      } catch (e) {
        console.warn(
          '[MQTT] Position parse failed for node',
          nodeId,
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
        this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
        this.emitMinimalNodeUpdate(nodeId);
      }
    } else if (portnum === PortNum.TEXT_MESSAGE_APP && (payload?.length || data.emoji)) {
      try {
        const text = new TextDecoder().decode(payload ?? new Uint8Array());
        const emoji = data.emoji || undefined;
        const replyId = data.replyId || undefined;
        const msg: Omit<ChatMessage, 'id'> & { from_mqtt: boolean } = {
          sender_id: nodeId,
          sender_name: `!${nodeId.toString(16)}`,
          payload: text,
          channel: 0,
          timestamp: Date.now(),
          packetId,
          from_mqtt: true,
          emoji,
          replyId,
        };
        this.emit('message', msg);
        this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
        this.emitMinimalNodeUpdate(nodeId);
      } catch (e) {
        console.warn(
          '[MQTT] TextMessage parse failed for node',
          nodeId,
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
        this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
        this.emitMinimalNodeUpdate(nodeId);
      }
    } else {
      // Unknown portnum — at least track the node as seen
      this.upsertNodeCache({ node_id: nodeId, last_heard: Date.now() });
      this.emitMinimalNodeUpdate(nodeId);
    }
  }

  private emitMinimalNodeUpdate(nodeId: number): void {
    const cached = this.nodeCache.get(nodeId);
    this.emit('nodeUpdate', {
      node_id: nodeId,
      last_heard: Date.now(),
      from_mqtt: true,
      ...(cached?.long_name && { long_name: cached.long_name }),
      ...(cached?.short_name && { short_name: cached.short_name }),
      ...(cached?.hw_model && { hw_model: cached.hw_model }),
    });
  }

  /**
   * Attempt AES-128-CTR decryption with a specific key.
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
      // AES-128-CTR nonce: packetId (4 bytes LE) + from (4 bytes LE) + 8 zero bytes
      const nonce = Buffer.alloc(16, 0);
      nonce.writeUInt32LE(packetId >>> 0, 0);
      nonce.writeUInt32LE(from >>> 0, 4);
      const decipher = createDecipheriv('aes-128-ctr', key, nonce);
      return Buffer.concat([decipher.update(Buffer.from(encrypted)), decipher.final()]);
    } catch {
      // catch-no-log-ok AES decrypt failed with this key — caller tries next key
      return null;
    }
  }

  /**
   * Try decrypting with DEFAULT_PSK first, then any configured extraPsks.
   * Validates each decryption attempt by parsing the result as a DataSchema protobuf.
   * Returns the decoded Data message if any key succeeds, null if all fail.
   */
  private tryDecryptAllKeys(
    encrypted: Uint8Array,
    packetId: number,
    from: number,
  ): { portnum?: number; payload?: Uint8Array; emoji?: number; replyId?: number } | null {
    for (const key of [DEFAULT_PSK, ...this.extraPsks]) {
      const raw = this.tryDecryptWithKey(encrypted, packetId, from, key);
      if (!raw) continue;
      try {
        return fromBinary(DataSchema, raw) as {
          portnum?: number;
          payload?: Uint8Array;
          emoji?: number;
          replyId?: number;
        };
      } catch {
        // Wrong PSK produces garbage bytes that fail protobuf decode — try next key
        console.debug('[MQTT] decrypt attempt failed (wrong key), trying next'); // log-filter-ok Meshtastic MQTT logs → App log panel
      }
    }
    return null;
  }
}
