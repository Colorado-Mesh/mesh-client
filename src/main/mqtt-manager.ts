import { EventEmitter } from "events";
import * as mqtt from "mqtt";
import { createDecipheriv, createCipheriv } from "crypto";
import { fromBinary, toBinary, create } from "@bufbuild/protobuf";
import { Mqtt as MqttProto, Mesh, Portnums } from "@meshtastic/protobufs";
import type { MeshNode, ChatMessage, MQTTSettings, MQTTStatus } from "../renderer/lib/types";

const { ServiceEnvelopeSchema } = MqttProto;
const { UserSchema, PositionSchema, DataSchema, MeshPacketSchema } = Mesh;
const { PortNum } = Portnums;

// Default PSK for meshtastic: 0x01 followed by 15 zero bytes
const DEFAULT_PSK = Buffer.from([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

// Dedup window: 10 minutes
const DEDUP_TTL_MS = 10 * 60 * 1000;

function coordWarning(lat: number, lon: number): string | null {
  if (lat === 0 && lon === 0) return "No GPS fix (0°, 0°)";
  if (lat < -90 || lat > 90) return `Latitude out of range: ${lat.toFixed(4)}°`;
  if (lon < -180 || lon > 180) return `Longitude out of range: ${lon.toFixed(4)}°`;
  if (lat === 90 && lon === 0) return "GPS no fix (reports North Pole)";
  return null;
}

export class MQTTManager extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private status: MQTTStatus = "disconnected";
  private seenPacketIds = new Map<number, number>(); // packetId → expiry timestamp
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSettings: MQTTSettings | null = null;
  private clientId = "";

  connect(settings: MQTTSettings): void {
    // Disconnect any existing connection first
    this.disconnect();

    this.currentSettings = settings;
    this.retryCount = 0;
    this.setStatus("connecting");
    this._doConnect(settings);
  }

  private _doConnect(settings: MQTTSettings): void {
    this.clientId = `meshtastic-electron-${Math.random().toString(36).slice(2, 8)}`;
    const clientId = this.clientId;

    this.client = mqtt.connect({
      host: settings.server,
      port: settings.port,
      protocol: "mqtt",
      protocolVersion: 4,          // force MQTT 3.1.1; avoids v5 negotiation issues
      clientId,                    // stable unique ID; prevents broker session collision
      username: settings.username || undefined,
      password: settings.password || undefined,
      clean: true,
      keepalive: 60,
      connectTimeout: 30_000,
      reconnectPeriod: 0,          // we manage reconnects manually
      rejectUnauthorized: false,   // no-op for plain mqtt; prevents TLS chain errors on mqtts
    });

    this.client.on("connect", () => {
      this.setStatus("connected");
      this.emit("clientId", this.clientId);

      // Guard: only subscribe if still connected
      if (!this.client?.connected) return;

      // Normalize prefix: ensure it ends with "/" before appending the wildcard
      const prefix = settings.topicPrefix.endsWith("/")
        ? settings.topicPrefix
        : `${settings.topicPrefix}/`;
      const topic = `${prefix}#`;
      this.client.subscribe(topic, (err) => {
        if (err) {
          // "Connection closed" is a cascade from a network reset — not fatal,
          // the client will reconnect and resubscribe automatically.
          const isCascade = err.message.toLowerCase().includes("connection closed") ||
            err.message.toLowerCase().includes("connection reset");
          if (isCascade) {
            console.warn("[MQTT] Subscribe interrupted (will retry on reconnect):", err.message);
          } else {
            console.error("[MQTT] Subscribe failed:", err);
            this.setError(`Subscribe failed: ${err.message}`);
          }
        } else {
          // Only reset retry count after a fully stable connection + subscribe
          this.retryCount = 0;
          console.log("[MQTT] Subscribed to", topic);
        }
      });
    });

    this.client.on("message", (_topic: string, payload: Buffer) => {
      this.onMessage(payload);
    });

    this.client.on("error", (err: NodeJS.ErrnoException) => {
      // Transient network errors will trigger 'close' → our backoff handler; don't
      // flip status to "error" for them — that would hide the "connecting" state.
      const isTransient = err.code === "ECONNRESET" || err.code === "ECONNREFUSED" ||
        err.code === "ETIMEDOUT" || err.code === "ENOTFOUND";
      if (isTransient) {
        console.warn("[MQTT] Network error (will reconnect):", err.message);
      } else {
        console.error("[MQTT] Fatal connection error:", err);
        this.setError(err.message);
      }
    });

    this.client.on("close", () => {
      if (this.status === "disconnected" || !this.currentSettings) return;

      const maxRetries = this.currentSettings.maxRetries ?? 5;
      if (this.retryCount >= maxRetries) {
        this.setError(`Connection lost after ${maxRetries} reconnect attempt${maxRetries === 1 ? "" : "s"}`);
        return;
      }

      this.retryCount++;
      const delay = Math.min(2000 * Math.pow(2, this.retryCount - 1), 60_000);
      console.warn(`[MQTT] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${maxRetries})`);
      this.setStatus("connecting");

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.status !== "disconnected" && this.currentSettings) {
          this._doConnect(this.currentSettings);
        }
      }, delay);
    });

    this.client.on("offline", () => {
      if (this.status !== "disconnected") {
        this.setStatus("connecting");
      }
    });
  }

  publish(text: string, from: number, channel: number, destination: number, channelName: string): number {
    if (!this.client?.connected || !this.currentSettings) {
      throw new Error("MQTT not connected");
    }

    const packetId = (Math.random() * 0xFFFFFFFF) >>> 0;

    // Build Data protobuf
    const data = create(DataSchema, {
      portnum: PortNum.TEXT_MESSAGE_APP,
      payload: new TextEncoder().encode(text),
    });
    const dataBytes = toBinary(DataSchema, data);

    // Encrypt with AES-128-CTR using the same nonce convention as decrypt
    const nonce = Buffer.alloc(16, 0);
    nonce.writeUInt32LE(packetId >>> 0, 0);
    nonce.writeUInt32LE(from >>> 0, 4);
    const cipher = createCipheriv("aes-128-ctr", DEFAULT_PSK, nonce);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(dataBytes)), cipher.final()]);

    // Build MeshPacket
    const packet = create(MeshPacketSchema, {
      from,
      to: destination,
      id: packetId,
      channel,
      hopLimit: 3,
      payloadVariant: { case: "encrypted", value: encrypted },
    });

    // Build ServiceEnvelope and publish
    const gatewayId = `!${from.toString(16).padStart(8, "0")}`;
    const envelope = create(ServiceEnvelopeSchema, {
      packet,
      channelId: channelName,
      gatewayId,
    });
    const prefix = this.currentSettings.topicPrefix.endsWith("/")
      ? this.currentSettings.topicPrefix
      : `${this.currentSettings.topicPrefix}/`;
    this.client.publish(
      `${prefix}2/e/${channelName}/${gatewayId}`,
      Buffer.from(toBinary(ServiceEnvelopeSchema, envelope))
    );

    return packetId;
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
    this.setStatus("disconnected");
  }

  getStatus(): MQTTStatus {
    return this.status;
  }

  private setStatus(s: MQTTStatus): void {
    this.status = s;
    this.emit("status", s);
  }

  private setError(message: string): void {
    this.status = "error";
    this.emit("status", "error");
    this.emit("error", message);
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

  private onMessage(payload: Buffer): void {
    try {
      const envelope = fromBinary(ServiceEnvelopeSchema, payload);
      const packet = envelope.packet;
      if (!packet || !packet.from) return;

      const nodeId = packet.from;
      const packetId = packet.id;

      if (packetId && this.isDuplicate(packetId)) return;

      const payloadCase = packet.payloadVariant?.case;

      if (payloadCase === "decoded") {
        const decoded = packet.payloadVariant!.value as { portnum?: number; payload?: Uint8Array };
        this.handleDecoded(nodeId, packetId, decoded);
      } else if (payloadCase === "encrypted") {
        const encrypted = packet.payloadVariant!.value as Uint8Array;
        const decrypted = this.tryDecrypt(encrypted, packetId, nodeId);
        if (decrypted) {
          try {
            const data = fromBinary(DataSchema, decrypted);
            this.handleDecoded(nodeId, packetId, data as { portnum?: number; payload?: Uint8Array });
          } catch {
            this.emitMinimalNodeUpdate(nodeId);
          }
        } else {
          this.emitMinimalNodeUpdate(nodeId);
        }
      }
    } catch {
      // Silently ignore parse errors — not all MQTT messages are ServiceEnvelopes
    }
  }

  private handleDecoded(nodeId: number, packetId: number, data: { portnum?: number; payload?: Uint8Array }): void {
    const portnum = data.portnum ?? 0;
    const payload = data.payload;

    if (portnum === PortNum.NODEINFO_APP && payload) {
      try {
        const user = fromBinary(UserSchema, payload);
        const nodeUpdate: Partial<MeshNode> & { node_id: number; from_mqtt: boolean } = {
          node_id: nodeId,
          long_name: user.longName || "",
          short_name: user.shortName || "",
          hw_model: String(user.hwModel ?? ""),
          last_heard: Date.now(),
          from_mqtt: true,
        };
        this.emit("nodeUpdate", nodeUpdate);
      } catch {
        this.emitMinimalNodeUpdate(nodeId);
      }
    } else if (portnum === PortNum.POSITION_APP && payload) {
      try {
        const pos = fromBinary(PositionSchema, payload);
        const lat = (pos.latitudeI ?? 0) / 1e7;
        const lon = (pos.longitudeI ?? 0) / 1e7;
        const warning = coordWarning(lat, lon);

        if (warning) {
          this.emit("nodeUpdate", { node_id: nodeId, positionWarning: warning, last_heard: Date.now(), from_mqtt: true });
        } else if (pos.latitudeI || pos.longitudeI) {
          const nodeUpdate: Partial<MeshNode> & { node_id: number; from_mqtt: boolean; positionWarning: null } = {
            node_id: nodeId,
            latitude: lat,
            longitude: lon,
            altitude: pos.altitude ?? undefined,
            last_heard: Date.now(),
            from_mqtt: true,
            positionWarning: null,
          };
          this.emit("nodeUpdate", nodeUpdate);
        } else {
          this.emitMinimalNodeUpdate(nodeId);
        }
      } catch {
        this.emitMinimalNodeUpdate(nodeId);
      }
    } else if (portnum === PortNum.TEXT_MESSAGE_APP && payload) {
      try {
        const text = new TextDecoder().decode(payload);
        const msg: Omit<ChatMessage, "id"> & { from_mqtt: boolean } = {
          sender_id: nodeId,
          sender_name: `!${nodeId.toString(16)}`,
          payload: text,
          channel: 0,
          timestamp: Date.now(),
          packetId,
          from_mqtt: true,
        };
        this.emit("message", msg);
        this.emitMinimalNodeUpdate(nodeId);
      } catch {
        this.emitMinimalNodeUpdate(nodeId);
      }
    } else {
      // Unknown portnum — at least track the node as seen
      this.emitMinimalNodeUpdate(nodeId);
    }
  }

  private emitMinimalNodeUpdate(nodeId: number): void {
    this.emit("nodeUpdate", {
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
      nonce.writeUInt32LE(packetId >>> 0, 0);
      nonce.writeUInt32LE(from >>> 0, 4);

      const decipher = createDecipheriv("aes-128-ctr", DEFAULT_PSK, nonce);
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted)),
        decipher.final(),
      ]);
    } catch {
      return null;
    }
  }
}
