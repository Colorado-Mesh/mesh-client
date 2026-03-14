import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { Mesh, Mqtt as MqttProto, Portnums } from '@meshtastic/protobufs';
import { createCipheriv, createDecipheriv } from 'crypto';
import { EventEmitter } from 'events';
import * as mqtt from 'mqtt';

import type { ChatMessage, MeshNode, MQTTSettings, MQTTStatus } from '../renderer/lib/types';
import { sanitizeLogMessage } from './log-service';

const { ServiceEnvelopeSchema } = MqttProto;
const { UserSchema, PositionSchema, DataSchema, MeshPacketSchema } = Mesh;
const { PortNum } = Portnums;

// Default PSK for meshtastic: 0x01 followed by 15 zero bytes
const DEFAULT_PSK = Buffer.from([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

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

export class MQTTManager extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private status: MQTTStatus = 'disconnected';
  private seenPacketIds = new Map<number, number>(); // packetId → expiry timestamp
  private nodeCache = new Map<number, CachedNode>();
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSettings: MQTTSettings | null = null;
  private clientId = '';

  connect(settings: MQTTSettings): void {
    // Disconnect any existing connection first
    this.disconnect();

    this.currentSettings = settings;
    this.retryCount = 0;
    this.setStatus('connecting');
    this._doConnect(settings);
  }

  private _doConnect(settings: MQTTSettings): void {
    this.clientId = `meshtastic-electron-${Math.random().toString(36).slice(2, 8)}`;
    const clientId = this.clientId;

    // Port 8883 is the conventional MQTT-over-TLS port: use mqtts and verify certs unless tlsInsecure is set.
    const useTls = settings.port === 8883;
    const rejectUnauthorized = useTls ? !settings.tlsInsecure : false;

    this.client = mqtt.connect({
      host: settings.server,
      port: settings.port,
      protocol: useTls ? 'mqtts' : 'mqtt',
      protocolVersion: 4, // force MQTT 3.1.1; avoids v5 negotiation issues
      clientId, // stable unique ID; prevents broker session collision
      username: settings.username || undefined,
      password: settings.password || undefined,
      clean: true,
      keepalive: 60,
      connectTimeout: 30_000,
      reconnectPeriod: 0, // we manage reconnects manually
      rejectUnauthorized,
    });

    this.client.on('connect', () => {
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
            console.error('[MQTT] Subscribe failed:', sanitizeLogMessage(err.message));
            this.setError(`Subscribe failed: ${err.message}`);
          }
        } else {
          // Only reset retry count after a fully stable connection + subscribe
          this.retryCount = 0;
          console.log('[MQTT] Subscribed to', topic);
        }
      });
    });

    this.client.on('message', (topic: string, payload: Buffer | string) => {
      this.onMessage(topic, payload);
    });

    this.client.on('error', (err: Error & { code?: string | number }) => {
      // Transient network errors will trigger 'close' → our backoff handler; don't
      // flip status to "error" for them — that would hide the "connecting" state.
      const code = String(err.code ?? '');
      const isTransient =
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        code === 'ENOTFOUND';
      if (isTransient) {
        console.warn('[MQTT] Network error (will reconnect):', sanitizeLogMessage(err.message));
      } else {
        console.error('[MQTT] Fatal connection error:', sanitizeLogMessage(err.message));
        this.setError(err.message);
      }
    });

    this.client.on('close', () => {
      if (this.status === 'disconnected' || !this.currentSettings) return;

      const maxRetries = this.currentSettings.maxRetries ?? 5;
      if (this.retryCount >= maxRetries) {
        this.setError(
          `Connection lost after ${maxRetries} reconnect attempt${maxRetries === 1 ? '' : 's'}`,
        );
        return;
      }

      this.retryCount++;
      const delay = Math.min(2000 * Math.pow(2, this.retryCount - 1), 60_000);
      console.warn(`[MQTT] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${maxRetries})`);
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

    const fromId = Number(from) >>> 0;
    const toId = Number(to) >>> 0;
    const channelId = Number(channel) >>> 0;

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

    const fromId = Number(from) >>> 0;
    const destId = Number(destination) >>> 0;
    const channelId = Number(channel) >>> 0;

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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    // Cleanup expired entries occasionally
    if (this.seenPacketIds.size > 10_000) {
      for (const [id, expiry] of this.seenPacketIds) {
        if (expiry < now) this.seenPacketIds.delete(id);
      }
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
    const cleanBytes = Uint8Array.from(Buffer.from(payload));
    if (cleanBytes.length === 0) return;

    if (cleanBytes[0] === 0x7b) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(cleanBytes));
        this.handleJsonMessage(parsed, topic);
      } catch {
        // Silent: not valid JSON, skip
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
        const decoded = packet.payloadVariant!.value as {
          portnum?: number;
          payload?: Uint8Array;
        };
        const portnum = decoded.portnum ?? 0;
        console.log('[SUCCESS] Topic:', sanitizeLogMessage(topic), '| Portnum:', portnum);
        this.handleDecoded(nodeId, packetId, decoded);
      } else if (payloadCase === 'encrypted') {
        const encrypted = packet.payloadVariant!.value as Uint8Array;
        const decrypted = this.tryDecrypt(encrypted, packetId, nodeId);
        if (decrypted) {
          try {
            const decodedData = fromBinary(DataSchema, decrypted);
            const portnum = (decodedData as { portnum?: number }).portnum ?? 0;
            console.log('[SUCCESS] Topic:', sanitizeLogMessage(topic), '| Portnum:', portnum);
            this.handleDecoded(
              nodeId,
              packetId,
              decodedData as { portnum?: number; payload?: Uint8Array },
            );
          } catch {
            this.emitMinimalNodeUpdate(nodeId);
          }
        } else {
          this.emitMinimalNodeUpdate(nodeId);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        '[PROTO ERROR]',
        sanitizeLogMessage(msg),
        '| Topic:',
        sanitizeLogMessage(topic),
      );
      const hex20 = Buffer.from(cleanBytes.slice(0, 20)).toString('hex').slice(0, 40);
      console.error('[PROTO DUMP] Length:', cleanBytes.length, '| Hex:', hex20);
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
        const nodeUpdate: Partial<MeshNode> & { node_id: number; from_mqtt: boolean } = {
          node_id: nodeId,
          long_name: user.longName || '',
          short_name: user.shortName || '',
          hw_model: String(user.hwModel ?? ''),
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
          e instanceof Error ? e.message : String(e),
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
          e instanceof Error ? e.message : String(e),
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
          e instanceof Error ? e.message : String(e),
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
    this.emit('nodeUpdate', {
      node_id: nodeId,
      last_heard: Date.now(),
      from_mqtt: true,
    });
  }

  private tryDecrypt(encrypted: Uint8Array, packetId: number, from: number): Buffer | null {
    try {
      // AES-128-CTR with default PSK
      // Nonce: packetId (4 bytes LE) + from (4 bytes LE) + 8 zero bytes
      const nonce = Buffer.alloc(16, 0);
      const fromId = Number(from) >>> 0;
      nonce.writeUInt32LE(packetId >>> 0, 0);
      nonce.writeUInt32LE(fromId >>> 0, 4);

      const decipher = createDecipheriv('aes-128-ctr', DEFAULT_PSK, nonce);
      return Buffer.concat([decipher.update(Buffer.from(encrypted)), decipher.final()]);
    } catch {
      return null;
    }
  }
}
