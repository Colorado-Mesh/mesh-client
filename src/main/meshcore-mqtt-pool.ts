import { EventEmitter } from 'events';

import type { MQTTSettings, MQTTStatus } from '../renderer/lib/types';
import {
  MAX_MESHCORE_MQTT_CONNECTIONS,
  MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS,
  MESHCORE_MQTT_CHAT_CONNECTION_ID,
  type MeshcoreMqttConnectionRole,
} from '../shared/meshcoreMqttConnections';
import type { MeshcoreMqttChatEnvelopeV1 } from '../shared/meshcoreMqttEnvelope';
import { sanitizeLogMessage } from './log-service';
import {
  buildMeshcorePacketLogPayload,
  MeshcoreMqttAdapter as MeshcoreMqttAdapterClass,
  meshcoreMqttPubKey,
  type MeshcorePacketLogArgs,
  meshcorePacketTopicTail,
} from './meshcore-mqtt-adapter';

export type MeshcoreMqttRole = MeshcoreMqttConnectionRole;

export { MAX_MESHCORE_MQTT_CONNECTIONS, MESHCORE_MQTT_CHAT_CONNECTION_ID };

interface PoolEntry {
  adapter: MeshcoreMqttAdapterClass;
  role: MeshcoreMqttRole;
  publishOnly: boolean;
}

export interface MeshcoreMqttStatusEvent {
  status: MQTTStatus;
  connectionId: string;
  role: MeshcoreMqttRole;
}

export interface MeshcoreMqttTextEvent {
  connectionId: string;
  role: MeshcoreMqttRole;
}

export interface MeshcoreMqttErrorEvent extends MeshcoreMqttTextEvent {
  error: string;
}

export interface MeshcoreMqttWarningEvent extends MeshcoreMqttTextEvent {
  warning: string;
}

export interface MeshcoreMqttClientIdEvent extends MeshcoreMqttTextEvent {
  clientId: string;
}

export interface MeshcoreMqttTokenRefreshEvent {
  connectionId: string;
  serverHost: string;
}

function sameBroker(a: MQTTSettings | null, b: MQTTSettings): boolean {
  if (!a) return false;
  return (
    a.server.trim().toLowerCase() === b.server.trim().toLowerCase() &&
    a.port === b.port &&
    (a.username ?? '') === (b.username ?? '')
  );
}

function samePacketTopic(a: MQTTSettings | null, b: MQTTSettings): boolean {
  if (!a) return false;
  return (
    a.meshcorePacketLoggerEnabled === true &&
    meshcorePacketTopicTail(a) === meshcorePacketTopicTail(b)
  );
}

/**
 * Owns every MeshCore MQTT session: one bidirectional chat connection plus N publish-only
 * packet-analyzer feeds. Each adapter is single-session, so multi-broker support is a map of
 * independent adapters — chat routing and packet fan-out live here.
 */
export class MeshcoreMqttPool extends EventEmitter {
  private readonly entries = new Map<string, PoolEntry>();
  /** Called when two enabled feeds would publish identical data to the same broker/topic. */
  private onDuplicateFeedWarning?: (message: string) => void;

  setDuplicateFeedWarningHandler(handler: (message: string) => void): void {
    this.onDuplicateFeedWarning = handler;
  }

  getConnectionIds(): string[] {
    return [...this.entries.keys()];
  }

  getRole(connectionId: string): MeshcoreMqttRole | null {
    return this.entries.get(connectionId)?.role ?? null;
  }

  /** Sessions that still hold a socket or retry budget; terminal `error` entries do not. */
  private activeSessionCount(excludeId?: string): number {
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (id === excludeId) continue;
      if (entry.adapter.getStatus() !== 'error') count += 1;
    }
    return count;
  }

  private activeFeedCount(excludeId?: string): number {
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (id === excludeId) continue;
      if (entry.role === 'feed' && entry.adapter.getStatus() !== 'error') count += 1;
    }
    return count;
  }

  connect(
    connectionId: string,
    settings: MQTTSettings,
    options: { role: MeshcoreMqttRole; publishOnly?: boolean },
  ): void {
    const existing = this.entries.get(connectionId);
    // Replacing a live session or reconnecting a terminal-error entry both consume a slot.
    const addsActiveSession = !existing || existing.adapter.getStatus() === 'error';
    if (
      addsActiveSession &&
      this.activeSessionCount(connectionId) >= MAX_MESHCORE_MQTT_CONNECTIONS
    ) {
      throw new Error(
        `MeshCore MQTT connection limit reached (${MAX_MESHCORE_MQTT_CONNECTIONS}). Disconnect another broker first.`,
      );
    }
    if (
      options.role === 'feed' &&
      addsActiveSession &&
      this.activeFeedCount(connectionId) >= MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS
    ) {
      throw new Error(
        `MeshCore MQTT feed limit reached (${MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS} analyzer feeds). Disconnect another feed first.`,
      );
    }
    for (const [id, entry] of this.entries) {
      if (id === connectionId) continue;
      const other = entry.adapter.getSettings();
      if (sameBroker(other, settings)) {
        throw new Error(
          `MeshCore MQTT: ${settings.server.trim()}:${settings.port} with this username is already connected.`,
        );
      }
      if (options.publishOnly && samePacketTopic(other, settings)) {
        this.onDuplicateFeedWarning?.(
          `MeshCore MQTT: two brokers publish the same packet topic (${settings.topicPrefix}).`,
        );
      }
    }

    const publishOnly = options.publishOnly === true;
    if (existing && (existing.publishOnly !== publishOnly || existing.role !== options.role)) {
      // Role changes switch subscribe behaviour, so the adapter must be recreated.
      existing.adapter.disconnect();
      existing.adapter.removeAllListeners();
      this.entries.delete(connectionId);
    }

    let entry = this.entries.get(connectionId);
    if (!entry) {
      const adapter = new MeshcoreMqttAdapterClass();
      this.attachForwarders(connectionId, adapter, options.role);
      entry = { adapter, role: options.role, publishOnly };
      this.entries.set(connectionId, entry);
    }
    entry.role = options.role;
    entry.publishOnly = publishOnly;
    entry.adapter.connect(settings, { publishOnly });
  }

  private attachForwarders(
    connectionId: string,
    adapter: MeshcoreMqttAdapterClass,
    role: MeshcoreMqttRole,
  ): void {
    const base: MeshcoreMqttTextEvent = { connectionId, role };
    adapter.on('status', (status: MQTTStatus) => {
      this.emit('status', { ...base, status } satisfies MeshcoreMqttStatusEvent);
    });
    adapter.on('error', (error: string) => {
      this.emit('error', { ...base, error } satisfies MeshcoreMqttErrorEvent);
    });
    adapter.on('subscribeWarning', (warning: string) => {
      this.emit('warning', { ...base, warning } satisfies MeshcoreMqttWarningEvent);
    });
    adapter.on('clientId', (clientId: string) => {
      this.emit('clientId', { ...base, clientId } satisfies MeshcoreMqttClientIdEvent);
    });
    adapter.on('chatMessage', (message: unknown) => {
      // Publish-only feeds never emit chat; the chat adapter is the single ingest source.
      this.emit('chatMessage', message);
    });
    adapter.on(MeshcoreMqttAdapterClass.EVENT_PROACTIVE_TOKEN_REFRESH, (serverHost: string) => {
      this.emit('proactiveTokenRefresh', {
        connectionId,
        serverHost,
      } satisfies MeshcoreMqttTokenRefreshEvent);
    });
    adapter.on(MeshcoreMqttAdapterClass.EVENT_TOKEN_REFRESH_NEEDED, (serverHost: string) => {
      this.emit('tokenRefreshNeeded', {
        connectionId,
        serverHost,
      } satisfies MeshcoreMqttTokenRefreshEvent);
    });
  }

  disconnect(connectionId?: string): void {
    if (connectionId) {
      const entry = this.entries.get(connectionId);
      if (!entry) return;
      // Emit the terminal disconnected status through the pool before dropping the forwarder.
      entry.adapter.disconnect();
      entry.adapter.removeAllListeners();
      this.entries.delete(connectionId);
      return;
    }
    for (const entry of this.entries.values()) {
      entry.adapter.disconnect();
      entry.adapter.removeAllListeners();
    }
    this.entries.clear();
  }

  getStatus(connectionId: string): MQTTStatus {
    return this.entries.get(connectionId)?.adapter.getStatus() ?? 'disconnected';
  }

  getStatuses(): Record<string, MQTTStatus> {
    const statuses: Record<string, MQTTStatus> = {};
    for (const [id, entry] of this.entries) statuses[id] = entry.adapter.getStatus();
    return statuses;
  }

  getChatStatus(): MQTTStatus {
    for (const entry of this.entries.values()) {
      if (entry.role === 'chat') return entry.adapter.getStatus();
    }
    return 'disconnected';
  }

  isAnyConnected(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.adapter.getStatus() === 'connected') return true;
    }
    return false;
  }

  getClientId(connectionId?: string): string {
    if (connectionId) return this.entries.get(connectionId)?.adapter.getClientId() ?? '';
    const chat = this.findChatEntry();
    if (chat?.adapter.getStatus() === 'connected') return chat.adapter.getClientId();
    for (const entry of this.entries.values()) {
      if (entry.adapter.getStatus() === 'connected') return entry.adapter.getClientId();
    }
    return chat?.adapter.getClientId() ?? '';
  }

  getTokenInfo(connectionId: string): { token: string; expiresAt: number } | null {
    const entry = this.entries.get(connectionId);
    const server = entry?.adapter.getSettings()?.server;
    if (!entry || !server) return null;
    return entry.adapter.getTokenInfo(server);
  }

  updateToken(
    connectionId: string,
    token: string,
    expiresAt: number,
    expectedServer?: string,
  ): void {
    this.entries.get(connectionId)?.adapter.updateToken(token, expiresAt, expectedServer);
  }

  publishChat(envelope: MeshcoreMqttChatEnvelopeV1): void {
    const chat = this.findChatEntry();
    if (!chat) throw new Error('MeshCore MQTT not connected');
    chat.adapter.publishChat(envelope);
  }

  /**
   * Fan a single packet-log payload out to every connected analyzer feed. Serialization is cached
   * per v1_ pubkey because `origin_id` follows the connection's identity.
   */
  publishPacketLog(args: MeshcorePacketLogArgs): void {
    const payloads = new Map<string, string>();
    for (const entry of this.entries.values()) {
      if (entry.adapter.getStatus() !== 'connected') continue;
      if (!entry.adapter.isPacketLoggerEnabled()) continue;
      const settings = entry.adapter.getSettings();
      if (!settings) continue;
      const pubKey = meshcoreMqttPubKey(settings) ?? '';
      let payload = payloads.get(pubKey);
      if (payload === undefined) {
        payload = buildMeshcorePacketLogPayload(args, pubKey || undefined);
        payloads.set(pubKey, payload);
      }
      try {
        entry.adapter.publishPacketPayload(payload);
      } catch (e: unknown) {
        // One broken transport must not stop the remaining feeds from publishing.
        console.debug(
          '[MeshCore MQTT pool] packet log publish skipped:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    }
  }

  handlePowerSuspend(): void {
    for (const entry of this.entries.values()) entry.adapter.handlePowerSuspend();
  }

  handlePowerResume(): void {
    for (const entry of this.entries.values()) entry.adapter.handlePowerResume();
  }

  private findChatEntry(): PoolEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.role === 'chat') return entry;
    }
    return undefined;
  }
}
