/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- UnsupportedOperation stubs for Protocol surface not used on MeshCore */
import type { Connection } from '@liamcottle/meshcore.js';

import { meshcoreDmAckKeyU32 } from '../../hooks/meshcore/meshcoreHookPreamble';
import { rememberMeshcoreDiscoverSelf } from '../meshcore/meshcoreDiscoverSelfCache';
import type { MeshCoreContactRaw } from '../meshcore/meshcoreHookTypes';
import { seedMeshcorePrefixLookupMaps } from '../meshcore/meshcorePubKeyRegistry';
import { meshcoreCoerceRadioRxFrame, parseAutoaddConfigResponse } from '../meshcoreContactAutoAdd';
import { decodeMeshcoreDirectMessageEvents } from '../meshcoreDirectMessageDecode';
import { isMeshcoreRoomServerContactType } from '../meshcoreRoomMessageRouting';
import type { MeshCoreSelfInfoWire } from '../meshcoreTelemetryPrivacy';
import {
  isMeshcoreTransportStatusChatLine,
  meshcoreCompanionRxPathLenToHopCount,
  pubKeyPrefixHex,
  pubkeyToNodeId,
} from '../meshcoreUtils';
import { MC_PUSH_CONTACT_DELETED, MC_PUSH_CONTACTS_FULL } from '../meshcoreWireCodes';
import { effectiveMessageTimestampMs } from '../nodeStatus';
import type { ProtocolCapabilities } from '../radio/BaseRadioProvider';
import { MESHCORE_CAPABILITIES } from '../radio/BaseRadioProvider';
import type { TransportParams } from '../types';
import type { MeshCoreTransportParams } from './meshcore/MeshCoreTransport';
import { createMeshCoreConnection, reconnectMeshcoreSerial } from './meshcore/MeshCoreTransport';
import type {
  ContactRecord,
  DiscoveryInfo,
  DomainEvent,
  Protocol,
  SendMessageOptions,
  SendPositionOptions,
  SendResult,
  SendWaypointOptions,
  SetChannelOptions,
  SetOwnerOptions,
} from './Protocol';
import { UnsupportedOperation } from './Protocol';

const MESHCORE_COORD_SCALE = 1e6;

// MeshCore Connection event type codes
const EVENT_ADVERT = 128;
const EVENT_DIRECT_MESSAGE = 7;
const EVENT_CHANNEL_MESSAGE = 8;
const EVENT_NEW_CONTACT = 138;
const EVENT_PATH_UPDATED = 129;
const EVENT_DM_ACK = 130;
const EVENT_WAITING_MESSAGES = 131;
const EVENT_RF_RX = 136;
const EVENT_CONTACT_DELETED = MC_PUSH_CONTACT_DELETED;
const EVENT_CONTACTS_FULL = MC_PUSH_CONTACTS_FULL;
const EVENT_RX = 'rx';
const EVENT_DISCONNECTED = 'disconnected';

// --- Canonical MeshCore types live in meshcoreHookTypes; re-export for legacy imports ---

export type {
  CayenneLppEntry,
  MeshCoreContactRaw,
  MeshCoreNeighborEntry,
  MeshCoreNeighborResult,
  MeshCoreNodeTelemetry,
  MeshCoreRepeaterStatus,
  RxPacketEntry,
} from '../meshcore/meshcoreHookTypes';

interface MeshCoreEventBus {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  getSelfInfo(timeout?: number): Promise<MeshCoreSelfInfoWire>;
}

/**
 * MeshCore codec + SDK adapter. Stateless: the SDK handle is passed in to
 * every method that needs it. Per-subscription state (pubkey-prefix lookup
 * map) lives in a closure inside `subscribe`.
 *
 * Config/channel/companion operations that still require the legacy companion
 * path throw `UnsupportedOperation` — UI must gate with `ProtocolCapabilities`
 * and call `useMeshcorePanelActions` instead until step 2d lands in Protocol.
 */
export class MeshCoreProtocol implements Protocol {
  readonly type = 'meshcore';
  readonly capabilities: ProtocolCapabilities = MESHCORE_CAPABILITIES;

  // --- SDK bootstrap ---

  async createDevice(params: TransportParams): Promise<Connection> {
    if (params.type === 'serial' && params.portSignature) {
      return reconnectMeshcoreSerial(params.portSignature);
    }
    const transport = this.transportParamsToMeshCore(params);
    return createMeshCoreConnection(transport);
  }

  async destroyDevice(handle: unknown): Promise<void> {
    const conn = handle as Connection | null;
    if (conn) {
      try {
        await conn.close();
      } catch (e) {
        console.debug('[MeshCoreProtocol] close error', e);
      }
    }
  }

  subscribe(handle: unknown, emit: (event: DomainEvent) => void): () => void {
    const conn = handle as Connection;
    const bus = conn as unknown as MeshCoreEventBus;

    // Per-subscription state: prefix -> nodeId lookup populated by adverts and
    // consumed by direct-message decode. Tied to this subscription so swapping
    // identities does not pollute the map.
    const pubKeyByNodeId = new Map<number, Uint8Array>();
    const nodeIdByPrefix = new Map<string, number>();
    const roomNodeIds = new Set<number>();
    seedMeshcorePrefixLookupMaps(nodeIdByPrefix, pubKeyByNodeId);

    const onAdvert = (data: unknown) => {
      this.decodeAdvert(data, pubKeyByNodeId, nodeIdByPrefix).forEach(emit);
    };
    const onDm = (data: unknown) => {
      decodeMeshcoreDirectMessageEvents(
        data as {
          pubKeyPrefix: Uint8Array;
          text: string;
          senderTimestamp: number;
          txtType?: number;
          pathLen?: number;
        },
        nodeIdByPrefix,
        roomNodeIds,
      ).forEach(emit);
    };
    const onChannel = (data: unknown) => {
      this.decodeChannelMessage(data).forEach(emit);
    };
    const onContact = (data: unknown) => {
      this.decodeContact(data, pubKeyByNodeId, nodeIdByPrefix, roomNodeIds).forEach(emit);
    };
    const onPathUpdated = (data: unknown) => {
      this.decodePathUpdated(data).forEach(emit);
    };
    const onRx = (data: unknown) => {
      this.decodeRx(data).forEach(emit);
    };
    const onDmAck = (data: unknown) => {
      this.decodeDmAck(data).forEach(emit);
    };
    const onWaitingMessages = () => {
      emit({ type: 'meshcore_waiting_messages', payload: {} });
    };
    const onContactDeleted = (data: unknown) => {
      this.decodeContactDeleted(data).forEach(emit);
    };
    const onContactsFull = () => {
      emit({ type: 'meshcore_contacts_full', payload: {} });
    };
    const onRfRx = (data: unknown) => {
      this.decodeRfRx(data).forEach(emit);
    };
    const onDisconnected = () => {
      emit({ type: 'device_status', payload: { status: 'disconnected' } });
    };

    bus.on(EVENT_ADVERT, onAdvert);
    bus.on(EVENT_DIRECT_MESSAGE, onDm);
    bus.on(EVENT_CHANNEL_MESSAGE, onChannel);
    bus.on(EVENT_NEW_CONTACT, onContact);
    bus.on(EVENT_PATH_UPDATED, onPathUpdated);
    bus.on(EVENT_DM_ACK, onDmAck);
    bus.on(EVENT_WAITING_MESSAGES, onWaitingMessages);
    bus.on(EVENT_CONTACT_DELETED, onContactDeleted);
    bus.on(EVENT_CONTACTS_FULL, onContactsFull);
    bus.on(EVENT_RF_RX, onRfRx);
    bus.on(EVENT_RX, onRx);
    bus.on(EVENT_DISCONNECTED, onDisconnected);

    return () => {
      bus.off(EVENT_ADVERT, onAdvert);
      bus.off(EVENT_DIRECT_MESSAGE, onDm);
      bus.off(EVENT_CHANNEL_MESSAGE, onChannel);
      bus.off(EVENT_NEW_CONTACT, onContact);
      bus.off(EVENT_PATH_UPDATED, onPathUpdated);
      bus.off(EVENT_DM_ACK, onDmAck);
      bus.off(EVENT_WAITING_MESSAGES, onWaitingMessages);
      bus.off(EVENT_CONTACT_DELETED, onContactDeleted);
      bus.off(EVENT_CONTACTS_FULL, onContactsFull);
      bus.off(EVENT_RF_RX, onRfRx);
      bus.off(EVENT_RX, onRx);
      bus.off(EVENT_DISCONNECTED, onDisconnected);
      pubKeyByNodeId.clear();
      nodeIdByPrefix.clear();
      roomNodeIds.clear();
    };
  }

  identitySignature(params: TransportParams, info?: DiscoveryInfo): string {
    if (info?.publicKey?.length === 32) {
      const hex = Array.from(info.publicKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `meshcore:pk:${hex}`;
    }
    switch (params.type) {
      case 'ble':
        return `meshcore:ble:${params.peripheralId ?? 'unknown'}`;
      case 'serial':
        return `meshcore:serial:${params.portSignature ?? 'unknown'}`;
      case 'tcp':
        return `meshcore:tcp:${params.host}`;
      case 'mqtt':
        return `meshcore:mqtt:${params.broker}:${params.pubkey ?? 'anon'}`;
      default:
        throw new UnsupportedOperation(`meshcore signature for ${params.type}`);
    }
  }

  /**
   * Performs the discovery RPC against the freshly-created handle. Returns
   * the device pubkey. ConnectionDriver calls this between `createDevice`
   * and `subscribe` to seed identity signature resolution.
   */
  async discoverSelf(handle: unknown, timeoutMs = 5000): Promise<DiscoveryInfo> {
    const bus = handle as MeshCoreEventBus;
    const info = await bus.getSelfInfo(timeoutMs);
    // Stash full wire payload so TCP initConn can skip a duplicate getSelfInfo RPC.
    rememberMeshcoreDiscoverSelf(handle, info);
    return { publicKey: info.publicKey };
  }

  // --- Outbound ---

  async sendMessage(handle: unknown, opts: SendMessageOptions): Promise<SendResult> {
    if (handle == null) {
      throw new TypeError('meshcore sendMessage: connection handle is required');
    }
    const conn = handle as Connection;
    if (typeof opts.text !== 'string' || opts.text.length === 0) {
      throw new TypeError('MeshCore messages must contain text.');
    }
    if (opts.destination != null) {
      if (
        !(opts.destinationPubKey instanceof Uint8Array) ||
        opts.destinationPubKey.byteLength === 0
      ) {
        throw new Error(
          'MeshCore direct messages require destinationPubKey to be provided in SendMessageOptions.',
        );
      }
      const result = await conn.sendTextMessage(opts.destinationPubKey, opts.text);
      const ackCrc = result.expectedAckCrc;
      if (ackCrc == null) return {};
      const estTimeout =
        typeof result.estTimeout === 'number' && Number.isFinite(result.estTimeout)
          ? result.estTimeout
          : undefined;
      return {
        packetId: meshcoreDmAckKeyU32(ackCrc),
        ...(estTimeout != null ? { estTimeoutMs: estTimeout } : {}),
      };
    }
    await conn.sendChannelTextMessage(opts.channelIndex ?? 0, opts.text);
    return {};
  }

  async sendPosition(_handle: unknown, _opts: SendPositionOptions): Promise<void> {
    throw new UnsupportedOperation('meshcore sendPosition');
  }

  async sendTraceRoute(_handle: unknown, _nodeId: number): Promise<void> {
    throw new UnsupportedOperation(
      'meshcore sendTraceRoute (use Connection.requestPath in step 2d)',
    );
  }

  async sendWaypoint(_handle: unknown, _opts: SendWaypointOptions): Promise<void> {
    throw new UnsupportedOperation('meshcore sendWaypoint');
  }

  async deleteWaypoint(_handle: unknown, _id: number): Promise<void> {
    throw new UnsupportedOperation('meshcore deleteWaypoint');
  }

  // --- Device lifecycle ---

  async reboot(handle: unknown, _delay?: number): Promise<void> {
    const conn = handle as Connection;
    await conn.reboot();
  }

  async shutdown(_handle: unknown, _delay?: number): Promise<void> {
    throw new UnsupportedOperation('meshcore shutdown');
  }

  async factoryReset(_handle: unknown): Promise<void> {
    throw new UnsupportedOperation('meshcore factoryReset');
  }

  async resetNodeDb(_handle: unknown): Promise<void> {
    throw new UnsupportedOperation('meshcore resetNodeDb');
  }

  async rebootOta(_handle: unknown, _delay?: number): Promise<void> {
    throw new UnsupportedOperation('meshcore rebootOta');
  }

  async enterDfuMode(_handle: unknown): Promise<void> {
    throw new UnsupportedOperation('meshcore enterDfuMode');
  }

  async factoryResetConfig(_handle: unknown): Promise<void> {
    throw new UnsupportedOperation('meshcore factoryResetConfig');
  }

  async requestRefresh(_handle: unknown): Promise<void> {
    throw new UnsupportedOperation('meshcore requestRefresh');
  }

  // --- Config (impls land in step 2d) ---

  async setConfig(_handle: unknown, _config: unknown): Promise<void> {
    throw new UnsupportedOperation(
      'meshcore setConfig: use legacy companion paths until MeshCore JSON config lands in Protocol',
    );
  }

  async commitConfig(_handle: unknown): Promise<void> {
    throw new UnsupportedOperation(
      'meshcore commitConfig: use legacy companion commitConfig via panel actions',
    );
  }

  async setChannel(_handle: unknown, _opts: SetChannelOptions): Promise<void> {
    throw new UnsupportedOperation('meshcore setChannel (step 2d)');
  }

  async clearChannel(_handle: unknown, _index: number): Promise<void> {
    throw new UnsupportedOperation('meshcore clearChannel');
  }

  async setOwner(handle: unknown, opts: SetOwnerOptions): Promise<void> {
    const conn = handle as Connection;
    await conn.setAdvertName(opts.longName);
  }

  async setModuleConfig(_handle: unknown, _config: unknown): Promise<void> {
    throw new UnsupportedOperation('meshcore setModuleConfig');
  }

  async setCannedMessages(_handle: unknown, _messages: string[]): Promise<void> {
    throw new UnsupportedOperation('meshcore setCannedMessages');
  }

  async setRingtone(_handle: unknown, _ringtone: string): Promise<void> {
    throw new UnsupportedOperation('meshcore setRingtone');
  }

  // --- GPS / position ---

  async sendPositionToDevice(
    _handle: unknown,
    _lat: number,
    _lon: number,
    _alt?: number,
  ): Promise<void> {
    throw new UnsupportedOperation('meshcore sendPositionToDevice');
  }

  async requestPosition(_handle: unknown, _nodeId: number): Promise<void> {
    throw new UnsupportedOperation('meshcore requestPosition');
  }

  deleteNode(): Promise<void> {
    return Promise.reject(new UnsupportedOperation('meshcore deleteNode'));
  }

  // --- MeshCore-specific methods (not on Protocol interface; narrow via .type === 'meshcore') ---

  async sendAdvert(handle: unknown): Promise<void> {
    const conn = handle as Connection;
    await conn.sendFloodAdvert();
  }

  async syncClock(handle: unknown): Promise<void> {
    // `syncDeviceTime` exists on the SDK at runtime but is not in its public types.
    await (handle as { syncDeviceTime: () => Promise<void> }).syncDeviceTime();
  }

  async refreshContacts(handle: unknown): Promise<ContactRecord[]> {
    const conn = handle as Connection;
    const raw = (await conn.getContacts()) as MeshCoreContactRaw[];
    return raw.map((c) => ({
      publicKey: c.publicKey,
      type: c.type,
      name: c.advName,
      lastAdvert: c.lastAdvert,
      advLat: c.advLat,
      advLon: c.advLon,
      flags: c.flags,
      outPathLen: c.outPathLen,
      outPath: c.outPath,
    }));
  }

  async removeContact(handle: unknown, pubKey: Uint8Array): Promise<void> {
    const conn = handle as Connection;
    await conn.removeContact(pubKey);
  }

  async exportContact(handle: unknown, pubKey: Uint8Array): Promise<Uint8Array | null> {
    const conn = handle as Connection;
    const result = (await conn.exportContact(pubKey)) as Uint8Array | null | undefined;
    return result ?? null;
  }

  async shareContact(handle: unknown, pubKey: Uint8Array): Promise<void> {
    const conn = handle as Connection;
    await conn.shareContact(pubKey);
  }

  async importContact(handle: unknown, advertBytes: Uint8Array): Promise<void> {
    const conn = handle as Connection;
    await conn.importContact(advertBytes);
  }

  async signData(handle: unknown, data: Uint8Array): Promise<Uint8Array> {
    const conn = handle as Connection;
    const result = await conn.sign(data);
    return result;
  }

  async exportPrivateKey(handle: unknown): Promise<Uint8Array> {
    const conn = handle as Connection;
    const result = (await conn.exportPrivateKey()) as Uint8Array;
    return result;
  }

  async importPrivateKey(handle: unknown, privateKey: Uint8Array): Promise<void> {
    const conn = handle as Connection;
    await conn.importPrivateKey(privateKey);
  }

  // --- Decoders (pure; closure state passed in) ---

  private decodePathUpdated(raw: unknown): DomainEvent[] {
    const d = raw as { publicKey?: Uint8Array };
    if (!(d.publicKey instanceof Uint8Array) || d.publicKey.length !== 32) return [];
    const nodeId = pubkeyToNodeId(d.publicKey);
    if (nodeId === 0) return [];
    return [{ type: 'meshcore_path_updated', payload: { nodeId, publicKey: d.publicKey } }];
  }

  private decodeContactDeleted(raw: unknown): DomainEvent[] {
    if (raw == null || typeof raw !== 'object') return [];
    const d = raw as { publicKey?: Uint8Array };
    if (!(d.publicKey instanceof Uint8Array) || d.publicKey.length !== 32) return [];
    const nodeId = pubkeyToNodeId(d.publicKey);
    if (nodeId === 0) return [];
    return [{ type: 'meshcore_contact_deleted', payload: { nodeId, publicKey: d.publicKey } }];
  }

  private decodeAdvert(
    raw: unknown,
    pubKeyByNodeId: Map<number, Uint8Array>,
    nodeIdByPrefix: Map<string, number>,
  ): DomainEvent[] {
    const d = raw as {
      publicKey: Uint8Array;
      advLat?: number;
      advLon?: number;
      lastAdvert?: number;
      advName?: string;
    };
    if (d.publicKey.length !== 32) return [];
    const nodeId = pubkeyToNodeId(d.publicKey);
    if (nodeId === 0) return [];

    pubKeyByNodeId.set(nodeId, d.publicKey);
    const prefix = pubKeyPrefixHex(d.publicKey);
    nodeIdByPrefix.set(prefix, nodeId);

    const events: DomainEvent[] = [
      {
        type: 'node_info',
        payload: { nodeId, longName: d.advName, lastHeardAt: d.lastAdvert, publicKey: d.publicKey },
      },
    ];

    const hasLat = typeof d.advLat === 'number' && d.advLat !== 0;
    const hasLon = typeof d.advLon === 'number' && d.advLon !== 0;
    if (hasLat && hasLon) {
      events.push({
        type: 'position',
        payload: {
          nodeId,
          latitude: d.advLat! / MESHCORE_COORD_SCALE,
          longitude: d.advLon! / MESHCORE_COORD_SCALE,
          timestamp: d.lastAdvert ?? Date.now(),
        },
      });
    }
    return events;
  }

  /** MeshCore hop ACK / path-hash summaries — device log only, not chat. */
  private decodeTransportStatusChatLine(text: string): DomainEvent[] {
    const line = text.length > 220 ? `${text.slice(0, 220)}…` : text;
    return [
      {
        type: 'device_log',
        payload: {
          message: line,
          time: Date.now(),
          source: 'meshcore',
          level: 0,
        },
      },
    ];
  }

  private decodeChannelMessage(raw: unknown): DomainEvent[] {
    const d = raw as {
      channelIdx: number;
      text: string;
      senderTimestamp: number;
      pathLen?: number;
    };
    if (isMeshcoreTransportStatusChatLine(d.text)) {
      return this.decodeTransportStatusChatLine(d.text);
    }
    const hopCount = meshcoreCompanionRxPathLenToHopCount(d.pathLen);
    return [
      {
        type: 'text_message',
        payload: {
          // Companion channel events carry no sender id — the wire text itself (which embeds
          // the sender name, e.g. "Alice: hello") is the only available disambiguator so two
          // different senders posting in the same channel/second don't collide on one store id.
          id: `ch:${d.channelIdx}:${d.senderTimestamp}:${d.text}`,
          from: 0,
          to: 0,
          payload: d.text,
          channelIndex: d.channelIdx,
          timestamp: effectiveMessageTimestampMs(d.senderTimestamp * 1000),
          ...(hopCount != null ? { hopCount } : {}),
        },
      },
    ];
  }

  private decodeContact(
    raw: unknown,
    pubKeyByNodeId: Map<number, Uint8Array>,
    nodeIdByPrefix: Map<string, number>,
    roomNodeIds: Set<number>,
  ): DomainEvent[] {
    const d = raw as {
      publicKey?: Uint8Array;
      type?: number;
      advLat?: number;
      advLon?: number;
      lastAdvert?: number;
      advName?: string;
    };
    if (!(d.publicKey instanceof Uint8Array) || d.publicKey.length !== 32) return [];
    const nodeId = pubkeyToNodeId(d.publicKey);
    if (nodeId !== 0 && isMeshcoreRoomServerContactType(d.type)) {
      roomNodeIds.add(nodeId);
    }
    return this.decodeAdvert(
      {
        publicKey: d.publicKey,
        advLat: d.advLat,
        advLon: d.advLon,
        lastAdvert: d.lastAdvert,
        advName: d.advName,
      },
      pubKeyByNodeId,
      nodeIdByPrefix,
    );
  }

  private decodeDmAck(raw: unknown): DomainEvent[] {
    const d = raw as { ackCode?: number; roundTrip?: number };
    if (typeof d.ackCode !== 'number' || !Number.isFinite(d.ackCode)) {
      console.warn('[MeshCoreProtocol] event 130: non-numeric ackCode', d.ackCode);
      return [];
    }
    return [
      {
        type: 'meshcore_dm_ack',
        payload: {
          ackCode: d.ackCode,
          ...(typeof d.roundTrip === 'number' ? { roundTrip: d.roundTrip } : {}),
        },
      },
    ];
  }

  private decodeRfRx(raw: unknown): DomainEvent[] {
    const d = raw as { lastSnr?: number; lastRssi?: number; raw?: unknown };
    const finiteOrZero = (v: unknown): number =>
      typeof v === 'number' && Number.isFinite(v) ? v : 0;
    return [
      {
        type: 'meshcore_rf_rx',
        payload: {
          lastSnr: finiteOrZero(d.lastSnr),
          lastRssi: finiteOrZero(d.lastRssi),
          raw: d.raw instanceof Uint8Array && d.raw.length > 0 ? d.raw : null,
        },
      },
    ];
  }

  private decodeRx(raw: unknown): DomainEvent[] {
    const frame = meshcoreCoerceRadioRxFrame(raw);
    const autoadd = frame ? parseAutoaddConfigResponse(frame) : null;
    if (autoadd) {
      return [{ type: 'device_autoadd', payload: autoadd }];
    }
    return [];
  }

  // --- Helpers ---

  private transportParamsToMeshCore(params: TransportParams): MeshCoreTransportParams {
    switch (params.type) {
      case 'ble':
        return { transport: 'ble', blePeripheralId: params.peripheralId };
      case 'serial':
        return { transport: 'serial' };
      case 'tcp':
        return { transport: 'tcp', host: params.host };
      default:
        throw new UnsupportedOperation(`meshcore transport: ${params.type}`);
    }
  }
}

/** Shared singleton — one instance per protocol type, used by every identity. */
export const meshcoreProtocol = new MeshCoreProtocol();
