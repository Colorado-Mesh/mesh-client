/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- UnsupportedOperation stubs for Protocol surface not used on MeshCore */
import type { Connection } from '@liamcottle/meshcore.js';

import {
  MESHCORE_ROOM_MESSAGE_CHANNEL,
  meshcoreDmAckKeyU32,
} from '../../hooks/meshcore/meshcoreHookPreamble';
import { MESHCORE_TXT_TYPE_SIGNED_PLAIN } from '../meshcoreChannelText';
import { meshcoreCoerceRadioRxFrame, parseAutoaddConfigResponse } from '../meshcoreContactAutoAdd';
import { isMeshcoreTransportStatusChatLine, pubkeyToNodeId } from '../meshcoreUtils';
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
const EVENT_RX = 'rx';
const EVENT_DISCONNECTED = 'disconnected';

// --- Re-exported types for components that previously imported from this module ---

export interface RxPacketEntry {
  ts: number;
  snr: number;
  rssi: number;
  raw: Uint8Array;
  fromNodeId: number | null;
  routeTypeString: string | null;
  payloadTypeString: string | null;
  hopCount: number;
  /** CRC-32 fingerprint (8 hex chars) — matches optional DB `rx_packet_fingerprint` on messages. */
  messageFingerprintHex: string | null;
  transportScopeCode: number | null;
  transportReturnCode: number | null;
  advertName: string | null;
  advertLat: number | null;
  advertLon: number | null;
  advertTimestampSec: number | null;
  parseOk: boolean;
}

export interface MeshCoreContactRaw {
  publicKey: Uint8Array;
  type: number;
  advName: string;
  lastAdvert: number;
  advLat: number;
  advLon: number;
  flags: number;
  outPathLen?: number;
  outPath?: Uint8Array;
}

export interface MeshCoreRepeaterStatus {
  battMilliVolts: number;
  noiseFloor: number;
  lastRssi: number;
  lastSnr: number;
  nPacketsRecv: number;
  nPacketsSent: number;
  totalAirTimeSecs: number;
  totalUpTimeSecs: number;
  nSentFlood: number;
  nSentDirect: number;
  nRecvFlood: number;
  nRecvDirect: number;
  errEvents: number;
  nDirectDups: number;
  nFloodDups: number;
  currTxQueueLen: number;
}

export interface CayenneLppEntry {
  channel: number;
  type: number;
  value: number | { latitude: number; longitude: number; altitude: number };
}

export interface MeshCoreNodeTelemetry {
  fetchedAt: number;
  entries: CayenneLppEntry[];
  temperature?: number;
  relativeHumidity?: number;
  barometricPressure?: number;
  voltage?: number;
  gps?: { latitude: number; longitude: number; altitude: number };
}

export interface MeshCoreNeighborEntry {
  publicKeyPrefix: Uint8Array;
  prefixHex: string;
  resolvedNodeId: number;
  heardSecondsAgo: number;
  snr: number;
}

export interface MeshCoreNeighborResult {
  totalNeighboursCount: number;
  neighbours: MeshCoreNeighborEntry[];
  fetchedAt: number;
}

interface MeshCoreEventBus {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  getSelfInfo(timeout?: number): Promise<{ publicKey?: Uint8Array }>;
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

    const onAdvert = (data: unknown) => {
      this.decodeAdvert(data, pubKeyByNodeId, nodeIdByPrefix).forEach(emit);
    };
    const onDm = (data: unknown) => {
      this.decodeDirectMessage(data, nodeIdByPrefix).forEach(emit);
    };
    const onChannel = (data: unknown) => {
      this.decodeChannelMessage(data).forEach(emit);
    };
    const onContact = (data: unknown) => {
      this.decodeContact(data, pubKeyByNodeId, nodeIdByPrefix).forEach(emit);
    };
    const onRx = (data: unknown) => {
      this.decodeRx(data).forEach(emit);
    };
    const onDisconnected = () => {
      emit({ type: 'device_status', payload: { status: 'disconnected' } });
    };

    bus.on(EVENT_ADVERT, onAdvert);
    bus.on(EVENT_DIRECT_MESSAGE, onDm);
    bus.on(EVENT_CHANNEL_MESSAGE, onChannel);
    bus.on(EVENT_NEW_CONTACT, onContact);
    bus.on(EVENT_RX, onRx);
    bus.on(EVENT_DISCONNECTED, onDisconnected);

    return () => {
      bus.off(EVENT_ADVERT, onAdvert);
      bus.off(EVENT_DIRECT_MESSAGE, onDm);
      bus.off(EVENT_CHANNEL_MESSAGE, onChannel);
      bus.off(EVENT_NEW_CONTACT, onContact);
      bus.off(EVENT_RX, onRx);
      bus.off(EVENT_DISCONNECTED, onDisconnected);
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
    return { publicKey: info.publicKey };
  }

  // --- Outbound ---

  async sendMessage(handle: unknown, opts: SendMessageOptions): Promise<SendResult> {
    const conn = handle as Connection;
    if (opts.destination != null) {
      if (!opts.destinationPubKey) {
        throw new Error('MeshCore sendMessage requires destinationPubKey for DM');
      }
      const result = await conn.sendTextMessage(opts.destinationPubKey, opts.text);
      const ackCrc = result?.expectedAckCrc;
      return ackCrc != null ? { packetId: meshcoreDmAckKeyU32(ackCrc) } : {};
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
    if (d.publicKey?.length !== 32) return [];
    const nodeId = pubkeyToNodeId(d.publicKey);
    if (nodeId === 0) return [];

    pubKeyByNodeId.set(nodeId, d.publicKey);
    const prefix = Array.from(d.publicKey.slice(0, 6))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
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

  /** MeshCore hop ACK / path-hash summaries — device log only, not chat (see legacy event 7/8). */
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

  private decodeDirectMessage(raw: unknown, nodeIdByPrefix: Map<string, number>): DomainEvent[] {
    const d = raw as {
      pubKeyPrefix: Uint8Array;
      text: string;
      senderTimestamp: number;
      txtType?: number;
    };
    if (d.txtType === 1) return [];
    if (isMeshcoreTransportStatusChatLine(d.text)) {
      return this.decodeTransportStatusChatLine(d.text);
    }
    const prefix = Array.from(d.pubKeyPrefix)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const senderId = nodeIdByPrefix.get(prefix) ?? 0;
    const isSignedPlain = d.txtType === MESHCORE_TXT_TYPE_SIGNED_PLAIN;
    return [
      {
        type: 'text_message',
        payload: {
          id: isSignedPlain
            ? `room:${senderId}:${d.senderTimestamp}`
            : `${senderId}:${d.senderTimestamp}`,
          from: senderId,
          to: 0,
          payload: d.text,
          channelIndex: isSignedPlain ? MESHCORE_ROOM_MESSAGE_CHANNEL : -1,
          timestamp: d.senderTimestamp * 1000,
          ...(d.txtType != null ? { txtType: d.txtType } : {}),
          ...(isSignedPlain ? { roomServerId: senderId } : {}),
        },
      },
    ];
  }

  private decodeChannelMessage(raw: unknown): DomainEvent[] {
    const d = raw as { channelIdx: number; text: string; senderTimestamp: number };
    if (isMeshcoreTransportStatusChatLine(d.text)) {
      return this.decodeTransportStatusChatLine(d.text);
    }
    return [
      {
        type: 'text_message',
        payload: {
          id: `ch:${d.channelIdx}:${d.senderTimestamp}`,
          from: 0,
          to: 0,
          payload: d.text,
          channelIndex: d.channelIdx,
          timestamp: d.senderTimestamp * 1000,
        },
      },
    ];
  }

  private decodeContact(
    raw: unknown,
    pubKeyByNodeId: Map<number, Uint8Array>,
    nodeIdByPrefix: Map<string, number>,
  ): DomainEvent[] {
    const d = raw as {
      publicKey?: Uint8Array;
      advLat?: number;
      advLon?: number;
      lastAdvert?: number;
      advName?: string;
    };
    if (!(d.publicKey instanceof Uint8Array) || d.publicKey.length !== 32) return [];
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
