import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { type MeshDevice, Types } from '@meshtastic/core';
import { Admin, Channel as ProtobufChannel, Mesh, Portnums } from '@meshtastic/protobufs';

import {
  MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG,
  sanitizeUnicodeReactionScalar,
} from '../../../shared/reactionEmoji';
import {
  createBleConnection,
  createConnection,
  reconnectSerial,
  safeDisconnect,
} from '../connection';
import { createPacketDedupeRegistry } from '../drivers/packetDedupeRegistry';
import { meshtasticHwModelName } from '../hardwareModels';
import { meshtasticComputedRfHopsAway } from '../meshtasticRfHops';
import type { ProtocolCapabilities } from '../radio/BaseRadioProvider';
import { MESHTASTIC_CAPABILITIES } from '../radio/BaseRadioProvider';
import type { TransportParams } from '../types';
import type {
  ChannelEvent,
  DeviceGpsStateEvent,
  DeviceLogEvent,
  DeviceMetadataEvent,
  DiscoveryInfo,
  DomainEvent,
  ModuleConfigEvent,
  NeighborInfoEvent,
  Protocol,
  QueueStatusEvent,
  RawPacketEntry,
  SecurityConfigEvent,
  SendMessageOptions,
  SendPositionOptions,
  SendResult,
  SendWaypointOptions,
  SetChannelOptions,
  SetOwnerOptions,
  TelemetryIntervalEvent,
} from './Protocol';
import { UnsupportedOperation } from './Protocol';

const { DeviceStatusEnum } = Types;
const { PortNum } = Portnums;

const STATUS_CODE_MAP: Record<number, string> = {
  [DeviceStatusEnum.DeviceRestarting]: 'connecting',
  [DeviceStatusEnum.DeviceDisconnected]: 'disconnected',
  [DeviceStatusEnum.DeviceConnecting]: 'connecting',
  [DeviceStatusEnum.DeviceReconnecting]: 'connecting',
  [DeviceStatusEnum.DeviceConnected]: 'connected',
  [DeviceStatusEnum.DeviceConfiguring]: 'connecting',
  [DeviceStatusEnum.DeviceConfigured]: 'configured',
  8: 'stale',
};

/**
 * The SDK dispatches `onMeshPacket` for every packet and then a second typed
 * event for the same payload, so a TRACEROUTE_APP packet reaches `subscribe`
 * twice. Correlation state in `meshtasticTraceSideEffects` is consumed on the
 * first reply, so the duplicate would land as an uncorrelated row.
 */
const TRACE_ROUTE_DEDUPE_TTL_MS = 60_000;
const TRACE_ROUTE_DEDUPE_MAX_ENTRIES = 256;

/** Guard against a malformed RouteDiscovery advertising an implausible hop list. */
const MAX_TRACE_ROUTE_HOPS = 32;

/** NeighborInfo lists are firmware-capped well below this; bound the UI cost anyway. */
const MAX_NEIGHBOR_ENTRIES = 256;

/** Meshtastic text payloads are limited to ~237 bytes; allow slack for MQTT replays. */
const MAX_TEXT_MESSAGE_CHARS = 1024;
const MAX_RAW_PACKET_BYTES = 64 * 1024;

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Node numbers are unsigned 32-bit; reject NaN / negative / out-of-range values. */
function normalizedNodeNum(value: unknown): number | undefined {
  if (!isFiniteNumber(value)) return undefined;
  const num = Math.trunc(value);
  if (num < 0 || num > 0xffffffff) return undefined;
  return num >>> 0;
}

// The type parameter is an explicit call-site assertion of the SDK surface the
// caller needs; the runtime check is the same for every handle shape.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function requireHandle<T extends object>(handle: unknown, operation: string): T {
  if (handle == null || (typeof handle !== 'object' && typeof handle !== 'function')) {
    throw new TypeError(`${operation}: device handle is unavailable`);
  }
  return handle as T;
}

function assertFiniteCoordinates(operation: string, latitude: number, longitude: number): void {
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
    throw new TypeError(`${operation}: latitude/longitude must be finite numbers`);
  }
  if (Math.abs(latitude) > MAX_LATITUDE || Math.abs(longitude) > MAX_LONGITUDE) {
    throw new RangeError(`${operation}: latitude/longitude out of range`);
  }
}

function boundedRoute(route: readonly unknown[] | undefined): number[] {
  if (!route) return [];
  const hops: number[] = [];
  for (const hop of route) {
    if (hops.length >= MAX_TRACE_ROUTE_HOPS) break;
    const num = normalizedNodeNum(hop);
    if (num !== undefined) hops.push(num);
  }
  return hops;
}

/**
 * Meshtastic codec + SDK adapter. Stateless: every method that needs the SDK
 * takes the handle as a parameter. Lifecycle (watchdog, reconnect) lives in
 * `ConnectionDriver`, not here.
 */
export class MeshtasticProtocol implements Protocol {
  readonly type = 'meshtastic';
  readonly capabilities: ProtocolCapabilities = MESHTASTIC_CAPABILITIES;

  // --- SDK bootstrap ---

  async createDevice(params: TransportParams): Promise<MeshDevice> {
    switch (params.type) {
      case 'ble':
        return createBleConnection(params.peripheralId, 'meshtastic');
      case 'serial':
        // Use gesture-free reconnect only when a previously-granted port signature is
        // known; otherwise call requestPort() so Electron fires select-serial-port and
        // the port picker appears (mirrors MeshCoreProtocol.createDevice pattern).
        if (params.portSignature) {
          return reconnectSerial(params.portSignature);
        }
        return createConnection('serial');
      case 'http':
        return createConnection('http', params.host);
      case 'tcp':
        return createConnection('tcp', params.host);
      default:
        throw new UnsupportedOperation(`meshtastic transport: ${params.type}`);
    }
  }

  async destroyDevice(handle: unknown): Promise<void> {
    const device = handle as MeshDevice | null;
    if (device) await safeDisconnect(device);
  }

  subscribe(handle: unknown, emit: (event: DomainEvent) => void): () => void {
    const device = handle as MeshDevice;
    const unsubs: (() => void)[] = [];
    const push = (unsub: () => void) => unsubs.push(unsub);
    const fire = (events: DomainEvent[]) => {
      for (const e of events) emit(e);
    };
    const seenTraceRoutes = createPacketDedupeRegistry({
      ttlMs: TRACE_ROUTE_DEDUPE_TTL_MS,
      maxEntries: TRACE_ROUTE_DEDUPE_MAX_ENTRIES,
    });
    /** Emits a traceroute at most once per wire packet id (id 0 is not unique). */
    const fireTraceRoute = (packet: unknown) => {
      const events = this.decodeTraceRoute(packet);
      if (events.length === 0) return;
      const packetId = normalizedNodeNum((packet as { id?: unknown }).id);
      if (packetId && seenTraceRoutes.markSeen(packetId)) return;
      fire(events);
    };

    push(
      device.events.onDeviceStatus.subscribe((status) => {
        fire(this.decodeDeviceStatus(status));
      }),
    );
    push(
      device.events.onMeshPacket.subscribe((packet) => {
        if (packet.payloadVariant.case === 'decoded') {
          const portnum = packet.payloadVariant.value.portnum;
          if (portnum === PortNum.TEXT_MESSAGE_APP) {
            fire(this.decodeTextMessage(packet));
          } else if (portnum === PortNum.TRACEROUTE_APP) {
            fireTraceRoute(packet);
          }
        }
        fire(this.decodeRawPacket(packet));
      }),
    );
    push(
      device.events.onNodeInfoPacket.subscribe((p) => {
        fire(this.decodeNodeInfo(p));
      }),
    );
    push(
      device.events.onPositionPacket.subscribe((p) => {
        fire(this.decodePosition(p));
      }),
    );
    push(
      device.events.onTelemetryPacket.subscribe((p) => {
        fire(this.decodeTelemetry(p));
      }),
    );
    push(
      device.events.onWaypointPacket.subscribe((p) => {
        fire(this.decodeWaypoint(p));
      }),
    );
    push(
      device.events.onTraceRoutePacket.subscribe((p) => {
        fireTraceRoute(p);
      }),
    );
    push(
      device.events.onChannelPacket.subscribe((p) => {
        fire(this.decodeChannel(p));
      }),
    );
    push(
      device.events.onConfigPacket.subscribe((p) => {
        fire(this.decodeConfig(p));
      }),
    );
    push(
      device.events.onModuleConfigPacket.subscribe((p) => {
        fire(this.decodeModuleConfig(p));
      }),
    );
    push(
      device.events.onQueueStatus.subscribe((p) => {
        fire(this.decodeQueueStatus(p));
      }),
    );
    push(
      device.events.onLogRecord.subscribe((p) => {
        fire(this.decodeDeviceLog(p));
      }),
    );
    push(
      device.events.onDeviceMetadataPacket.subscribe((p) => {
        fire(this.decodeDeviceMetadata(p));
      }),
    );
    push(
      device.events.onNeighborInfoPacket.subscribe((p) => {
        fire(this.decodeNeighborInfo(p));
      }),
    );
    push(
      device.events.onMyNodeInfo.subscribe((info) => {
        const nodeId = normalizedNodeNum(info.myNodeNum);
        if (nodeId) {
          emit({ type: 'node_info', payload: { nodeId } });
        }
      }),
    );
    push(
      device.events.onUserPacket.subscribe((p) => {
        fire(this.decodeUserPacket(p));
      }),
    );
    push(
      device.events.onStoreForwardPacket.subscribe((p) => {
        const packet = p as { from?: number; channel?: number };
        emit({
          type: 'meshtastic_store_forward',
          payload: {
            from: normalizedNodeNum(packet.from) ?? 0,
            channel: isFiniteNumber(packet.channel) ? Math.trunc(packet.channel) : 0,
            raw: p,
            timestamp: Date.now(),
          },
        });
      }),
    );

    const emitModulePort = (portLabel: string, packet: unknown) => {
      const p = packet as { from?: number; channel?: number; data?: unknown };
      emit({
        type: 'meshtastic_module_port',
        payload: {
          portLabel,
          from: normalizedNodeNum(p.from) ?? 0,
          data: p.data ?? packet,
          channel: isFiniteNumber(p.channel) ? Math.trunc(p.channel) : undefined,
          timestamp: Date.now(),
        },
      });
    };
    push(
      device.events.onRemoteHardwarePacket.subscribe((p) => {
        emitModulePort('remoteHardware', p);
      }),
    );
    push(
      device.events.onAudioPacket.subscribe((p) => {
        emitModulePort('audio', p);
      }),
    );
    push(
      device.events.onDetectionSensorPacket.subscribe((p) => {
        emitModulePort('detectionSensor', p);
      }),
    );
    push(
      device.events.onPingPacket.subscribe((p) => {
        emitModulePort('ping', p);
      }),
    );
    push(
      device.events.onIpTunnelPacket.subscribe((p) => {
        emitModulePort('ipTunnel', p);
      }),
    );
    push(
      device.events.onPaxcounterPacket.subscribe((p) => {
        emitModulePort('paxcounter', p);
      }),
    );
    push(
      device.events.onSerialPacket.subscribe((p) => {
        emitModulePort('serial', p);
      }),
    );
    push(
      device.events.onRangeTestPacket.subscribe((p) => {
        emitModulePort('rangeTest', p);
      }),
    );
    push(
      device.events.onZpsPacket.subscribe((p) => {
        emitModulePort('zps', p);
      }),
    );
    push(
      device.events.onSimulatorPacket.subscribe((p) => {
        emitModulePort('simulator', p);
      }),
    );
    push(
      device.events.onAtakPluginPacket.subscribe((p) => {
        emitModulePort('atakPlugin', p);
      }),
    );
    push(
      device.events.onMapReportPacket.subscribe((p) => {
        emitModulePort('mapReport', p);
      }),
    );
    push(
      device.events.onPrivatePacket.subscribe((p) => {
        emitModulePort('private', p);
      }),
    );
    push(
      device.events.onAtakForwarderPacket.subscribe((p) => {
        emitModulePort('atakForwarder', p);
      }),
    );

    return () => {
      for (const u of unsubs) {
        try {
          u();
        } catch (e) {
          console.debug('[MeshtasticProtocol] unsub error', e);
        }
      }
    };
  }

  identitySignature(params: TransportParams, info?: DiscoveryInfo): string {
    if (info?.myNodeNum != null && info.myNodeNum > 0) {
      return `meshtastic:node:${info.myNodeNum}`;
    }
    switch (params.type) {
      case 'ble':
        return `meshtastic:ble:${params.peripheralId ?? 'unknown'}`;
      case 'serial':
        return `meshtastic:serial:${params.portSignature ?? 'unknown'}`;
      case 'http':
        return `meshtastic:http:${params.host}`;
      case 'tcp':
        return `meshtastic:tcp:${params.host}`;
      default:
        throw new UnsupportedOperation(`meshtastic signature for ${params.type}`);
    }
  }

  // --- Outbound ---

  async sendMessage(handle: unknown, opts: SendMessageOptions): Promise<SendResult> {
    const device = requireHandle<MeshDevice>(handle, 'meshtastic sendMessage');
    const text = typeof opts.text === 'string' ? opts.text : '';
    if (!text || text.length > MAX_TEXT_MESSAGE_CHARS) {
      throw new TypeError(
        `meshtastic sendMessage: text must be 1-${MAX_TEXT_MESSAGE_CHARS} characters`,
      );
    }
    const destination =
      opts.destination === undefined ? undefined : normalizedNodeNum(opts.destination);
    if (opts.destination !== undefined && destination === undefined) {
      throw new TypeError('meshtastic sendMessage: destination must be a valid node number');
    }
    const dest: number | 'broadcast' = destination ?? 'broadcast';
    const channelIndex = isFiniteNumber(opts.channelIndex) ? Math.trunc(opts.channelIndex) : 0;
    const result = await device.sendText(text, dest, true, channelIndex);
    const packetId = typeof result === 'number' ? result : undefined;
    return { packetId };
  }

  async sendPosition(handle: unknown, opts: SendPositionOptions): Promise<void> {
    await this.setDevicePosition(
      handle,
      'meshtastic sendPosition',
      opts.latitude,
      opts.longitude,
      opts.altitude,
    );
  }

  async sendTraceRoute(handle: unknown, nodeId: number): Promise<void> {
    const device = requireHandle<MeshDevice>(handle, 'meshtastic sendTraceRoute');
    const target = normalizedNodeNum(nodeId);
    if (target === undefined || target === 0) {
      throw new TypeError('meshtastic sendTraceRoute: nodeId must be a valid node number');
    }
    await device.traceRoute(target);
  }

  async sendWaypoint(handle: unknown, opts: SendWaypointOptions): Promise<void> {
    const device = handle as MeshDevice;
    assertFiniteCoordinates('meshtastic sendWaypoint', opts.latitude, opts.longitude);
    const id = normalizedNodeNum(opts.id);
    if (id === undefined) {
      throw new TypeError('meshtastic sendWaypoint: id must be a valid unsigned integer');
    }
    await device.sendWaypoint(
      create(Mesh.WaypointSchema, {
        id,
        name: opts.name,
        description: opts.description ?? '',
        latitudeI: Math.round(opts.latitude * 1e7),
        longitudeI: Math.round(opts.longitude * 1e7),
        lockedTo: opts.lockedTo ?? 0,
        expire: opts.expire ?? 0,
      }) as Parameters<MeshDevice['sendWaypoint']>[0],
      0xffffffff,
      0,
    );
  }

  async deleteWaypoint(handle: unknown, id: number): Promise<void> {
    const device = handle as MeshDevice;
    const waypointId = normalizedNodeNum(id);
    if (waypointId === undefined) {
      throw new TypeError('meshtastic deleteWaypoint: id must be a valid unsigned integer');
    }
    await device.sendWaypoint(
      create(Mesh.WaypointSchema, { id: waypointId, expire: 1 }) as Parameters<
        MeshDevice['sendWaypoint']
      >[0],
      0xffffffff,
      0,
    );
  }

  /** Meshtastic-specific extra: tapback reaction. Not part of the Protocol interface. */
  async sendReaction(
    handle: unknown,
    emoji: number,
    replyId: number,
    channelIndex: number,
  ): Promise<void> {
    const device = handle as MeshDevice;
    const safeScalar = sanitizeUnicodeReactionScalar(emoji);
    if (safeScalar === undefined) return;
    const parentId = normalizedNodeNum(replyId);
    if (!parentId) {
      throw new TypeError('meshtastic sendReaction: replyId must be a valid packet id');
    }
    await device.sendText(
      String.fromCodePoint(safeScalar),
      'broadcast',
      true,
      isFiniteNumber(channelIndex) ? Math.trunc(channelIndex) : 0,
      parentId,
      MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG,
    );
  }

  // --- Device lifecycle ---

  async reboot(handle: unknown, delay = 2): Promise<void> {
    await (handle as MeshDevice).reboot(delay);
  }

  async shutdown(handle: unknown, delay = 2): Promise<void> {
    await (handle as MeshDevice).shutdown(delay);
  }

  async factoryReset(handle: unknown): Promise<void> {
    await (handle as MeshDevice).factoryResetDevice();
  }

  async resetNodeDb(handle: unknown): Promise<void> {
    await (handle as MeshDevice).resetNodes();
  }

  async rebootOta(handle: unknown, delay = 2): Promise<void> {
    await (handle as MeshDevice).rebootOta(delay);
  }

  async enterDfuMode(handle: unknown): Promise<void> {
    await (handle as MeshDevice).enterDfuMode();
  }

  async factoryResetConfig(handle: unknown): Promise<void> {
    await (handle as MeshDevice).factoryResetConfig();
  }

  async requestRefresh(handle: unknown): Promise<void> {
    await (handle as MeshDevice).configure();
  }

  // --- Config ---

  async setConfig(handle: unknown, config: unknown): Promise<void> {
    await requireHandle<MeshDevice>(handle, 'meshtastic setConfig').setConfig(config as never);
  }

  async commitConfig(handle: unknown): Promise<void> {
    await (handle as MeshDevice).commitEditSettings();
  }

  async setChannel(handle: unknown, opts: SetChannelOptions): Promise<void> {
    const channel = create(ProtobufChannel.ChannelSchema, {
      index: opts.index,
      role: opts.role,
      settings: create(ProtobufChannel.ChannelSettingsSchema, {
        name: opts.settings.name,
        psk: opts.settings.psk,
        uplinkEnabled: opts.settings.uplinkEnabled,
        downlinkEnabled: opts.settings.downlinkEnabled,
        moduleSettings: create(ProtobufChannel.ModuleSettingsSchema, {
          positionPrecision: opts.settings.positionPrecision,
        }),
      }),
    }) as Parameters<MeshDevice['setChannel']>[0];
    await (handle as MeshDevice).setChannel(channel);
  }

  async clearChannel(handle: unknown, index: number): Promise<void> {
    await (handle as MeshDevice).clearChannel(index);
  }

  async setOwner(handle: unknown, opts: SetOwnerOptions): Promise<void> {
    const user = create(Mesh.UserSchema, {
      longName: opts.longName,
      shortName: opts.shortName,
      isLicensed: opts.isLicensed,
    }) as Parameters<MeshDevice['setOwner']>[0];
    await (handle as MeshDevice).setOwner(user);
  }

  async setModuleConfig(handle: unknown, config: unknown): Promise<void> {
    await requireHandle<{ setModuleConfig: (c: unknown) => Promise<void> }>(
      handle,
      'meshtastic setModuleConfig',
    ).setModuleConfig(config);
  }

  async setCannedMessages(handle: unknown, messages: string[]): Promise<void> {
    await (
      handle as { setCannedMessages: (m: { messages: string }) => Promise<void> }
    ).setCannedMessages({ messages: messages.join('\n') });
  }

  async setRingtone(handle: unknown, ringtone: string): Promise<void> {
    if (typeof ringtone !== 'string' || ringtone.length > 1024) {
      throw new TypeError('meshtastic setRingtone: ringtone must be at most 1024 characters');
    }
    const msg = create(Admin.AdminMessageSchema, {
      payloadVariant: { case: 'setRingtoneMessage', value: ringtone },
    });
    await requireHandle<{
      sendPacket: (b: Uint8Array, p: number, t: string) => Promise<void>;
    }>(handle, 'meshtastic setRingtone').sendPacket(
      toBinary(Admin.AdminMessageSchema, msg),
      Portnums.PortNum.ADMIN_APP,
      'self',
    );
  }

  // --- GPS / position ---

  /** Shared body for `sendPosition` and `sendPositionToDevice` (same firmware call). */
  private async setDevicePosition(
    handle: unknown,
    operation: string,
    latitude: number,
    longitude: number,
    altitude?: number,
  ): Promise<void> {
    assertFiniteCoordinates(operation, latitude, longitude);
    await requireHandle<MeshDevice>(handle, operation).setPosition(
      create(Mesh.PositionSchema, {
        latitudeI: Math.round(latitude * 1e7),
        longitudeI: Math.round(longitude * 1e7),
        altitude: isFiniteNumber(altitude) ? Math.round(altitude) : 0,
        time: Math.floor(Date.now() / 1000),
      }) as Parameters<MeshDevice['setPosition']>[0],
    );
  }

  async sendPositionToDevice(
    handle: unknown,
    lat: number,
    lon: number,
    alt?: number,
  ): Promise<void> {
    await this.setDevicePosition(handle, 'meshtastic sendPositionToDevice', lat, lon, alt);
  }

  async requestPosition(handle: unknown, nodeId: number): Promise<void> {
    const target = normalizedNodeNum(nodeId);
    if (target === undefined || target === 0) {
      throw new TypeError('meshtastic requestPosition: nodeId must be a valid node number');
    }
    await (handle as MeshDevice).requestPosition(target);
  }

  deleteNode(): Promise<void> {
    return Promise.reject(new UnsupportedOperation('meshtastic deleteNode'));
  }

  // --- Decoders (pure; called from subscribe) ---

  private decodeTextMessage(raw: unknown): DomainEvent[] {
    const p = raw as {
      payloadVariant: {
        case: string;
        value: { payload: Uint8Array; replyId?: number; reply_id?: number; emoji?: number };
      };
      from: number;
      to: number;
      id: number;
      channel?: number;
      rxTime?: number;
      rxSnr?: number;
      rxRssi?: number;
      hopStart?: number;
      hopLimit?: number;
      viaMqtt?: boolean;
    };
    if (p.payloadVariant?.case !== 'decoded') return [];
    const data = p.payloadVariant.value;
    if (!(data?.payload instanceof Uint8Array)) return [];
    const from = normalizedNodeNum(p.from);
    const to = normalizedNodeNum(p.to);
    if (from === undefined || to === undefined) return [];
    const hopCount = meshtasticComputedRfHopsAway(p);
    const rawReplyId = data.replyId ?? data.reply_id;
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data.payload);
    } catch {
      // catch-no-log-ok malformed inbound text is dropped before reaching UI or persistence
      return [];
    }
    return [
      {
        type: 'text_message',
        payload: {
          id: String(normalizedNodeNum(p.id) ?? 0),
          from,
          to,
          payload:
            text.length > MAX_TEXT_MESSAGE_CHARS ? text.slice(0, MAX_TEXT_MESSAGE_CHARS) : text,
          channelIndex: isFiniteNumber(p.channel) ? Math.trunc(p.channel) : 0,
          timestamp: p.rxTime ? p.rxTime * 1000 : Date.now(),
          rxSnr: p.rxSnr,
          rxRssi: p.rxRssi,
          ...(hopCount != null ? { hopCount } : {}),
          replyTo: rawReplyId ? String(rawReplyId) : undefined,
          tapback: data.emoji != null ? data.emoji !== 0 : undefined,
        },
      },
    ];
  }

  private decodeUserPacket(raw: unknown): DomainEvent[] {
    const p = raw as {
      from: number;
      rxTime?: number;
      data?: {
        longName?: string;
        shortName?: string;
        hwModel?: number;
        role?: number;
        publicKey?: Uint8Array;
        isLicensed?: boolean;
      };
    };
    const nodeId = normalizedNodeNum(p.from);
    if (!nodeId) return [];
    const user = p.data ?? {};
    return [
      {
        type: 'node_info',
        payload: {
          nodeId,
          longName: user.longName,
          shortName: user.shortName,
          hwModel: user.hwModel != null ? meshtasticHwModelName(user.hwModel) : undefined,
          role: user.role,
          publicKey: user.publicKey,
          isLicensed: user.isLicensed,
          lastHeardAt: p.rxTime ? p.rxTime * 1000 : Date.now(),
          fromUserPacket: true,
        },
      },
    ];
  }

  private decodeNodeInfo(raw: unknown): DomainEvent[] {
    const p = raw as {
      num?: number;
      user?: {
        longName?: string;
        shortName?: string;
        hwModel?: number;
        role?: number;
        publicKey?: Uint8Array;
      };
      lastHeard?: number;
      snr?: number;
      hopsAway?: number;
      viaMqtt?: boolean;
      position?: { latitudeI?: number; longitudeI?: number; altitude?: number };
      deviceMetrics?: {
        batteryLevel?: number;
        voltage?: number;
        channelUtilization?: number;
        airUtilTx?: number;
      };
    };
    const nodeId = normalizedNodeNum(p.num);
    if (!nodeId) return [];
    return [
      {
        type: 'node_info',
        payload: {
          nodeId,
          longName: p.user?.longName,
          shortName: p.user?.shortName,
          hwModel: p.user?.hwModel != null ? meshtasticHwModelName(p.user.hwModel) : undefined,
          role: p.user?.role,
          publicKey: p.user?.publicKey,
          lastHeardAt: p.lastHeard,
          snr: p.snr,
          hopsAway: p.hopsAway,
          viaMqtt: p.viaMqtt,
          latitude: p.position?.latitudeI != null ? p.position.latitudeI / 1e7 : undefined,
          longitude: p.position?.longitudeI != null ? p.position.longitudeI / 1e7 : undefined,
          altitude: p.position?.altitude,
          batteryLevel: p.deviceMetrics?.batteryLevel,
          voltage: p.deviceMetrics?.voltage,
          channelUtilization: p.deviceMetrics?.channelUtilization,
          airUtilTx: p.deviceMetrics?.airUtilTx,
        },
      },
    ];
  }

  private decodePosition(raw: unknown): DomainEvent[] {
    const p = raw as {
      from: number;
      rxTime?: number;
      data: { latitudeI?: number; longitudeI?: number; altitude?: number };
    };
    const nodeId = normalizedNodeNum(p.from);
    if (nodeId === undefined) return [];
    const latitude = (isFiniteNumber(p.data?.latitudeI) ? p.data.latitudeI : 0) / 1e7;
    const longitude = (isFiniteNumber(p.data?.longitudeI) ? p.data.longitudeI : 0) / 1e7;
    if (Math.abs(latitude) > MAX_LATITUDE || Math.abs(longitude) > MAX_LONGITUDE) return [];
    return [
      {
        type: 'position',
        payload: {
          nodeId,
          latitude,
          longitude,
          altitude: isFiniteNumber(p.data?.altitude) ? p.data.altitude : undefined,
          timestamp: p.rxTime ? p.rxTime * 1000 : Date.now(),
        },
      },
    ];
  }

  private decodeTelemetry(raw: unknown): DomainEvent[] {
    const p = raw as {
      from: number;
      rxTime?: number;
      data: {
        variant?: { case?: string; value?: Record<string, unknown> };
        deviceMetrics?: Record<string, unknown>;
      };
    };
    const m: Record<string, unknown> = p.data?.variant?.value ?? p.data?.deviceMetrics ?? {};
    const num = (key: string): number | undefined => m[key] as number | undefined;
    return [
      {
        type: 'telemetry',
        payload: {
          nodeId: p.from,
          timestamp: p.rxTime ? p.rxTime * 1000 : Date.now(),
          variantCase:
            p.data?.variant?.case ?? (p.data?.deviceMetrics ? 'deviceMetrics' : undefined),
          batteryLevel: num('batteryLevel'),
          voltage: num('voltage'),
          channelUtilization: num('channelUtilization'),
          airUtilTx: num('airUtilTx'),
          temperature: num('temperature'),
          relativeHumidity: num('relativeHumidity'),
          barometricPressure: num('barometricPressure'),
          iaq: num('iaq'),
          gasResistance: num('gasResistance'),
          lux: num('lux'),
          windSpeed: num('windSpeed'),
          windDirection: num('windDirection'),
          windGust: num('windGust'),
          windLull: num('windLull'),
          weight: num('weight'),
          rainfall1h: num('rainfall1h'),
          rainfall24h: num('rainfall24h'),
          numPacketsRxBad: num('numPacketsRxBad'),
          numRxDupe: num('numRxDupe'),
          numPacketsRx: num('numPacketsRx'),
          numPacketsTx: num('numPacketsTx'),
        },
      },
    ];
  }

  private decodeWaypoint(raw: unknown): DomainEvent[] {
    const p = raw as {
      from: number;
      to?: number;
      channel?: number;
      rxTime?: number;
      data: {
        id?: number;
        name?: string;
        latitudeI?: number;
        longitudeI?: number;
        description?: string;
        icon?: number;
        lockedTo?: number;
        expire?: number;
      };
    };
    const waypointId = normalizedNodeNum(p.data?.id);
    if (!waypointId) return [];
    const latitudeI = isFiniteNumber(p.data.latitudeI) ? p.data.latitudeI : 0;
    const longitudeI = isFiniteNumber(p.data.longitudeI) ? p.data.longitudeI : 0;
    return [
      {
        type: 'waypoint',
        payload: {
          id: waypointId,
          name: p.data.name ?? '',
          description: p.data.description,
          latitude: latitudeI / 1e7,
          longitude: longitudeI / 1e7,
          latitudeI,
          longitudeI,
          icon: p.data.icon,
          lockedTo: p.data.lockedTo,
          expire: p.data.expire,
          from: normalizedNodeNum(p.from) ?? 0,
          to: normalizedNodeNum(p.to),
          channelIndex: isFiniteNumber(p.channel) ? Math.trunc(p.channel) : undefined,
          timestamp: p.rxTime ? p.rxTime * 1000 : Date.now(),
        },
      },
    ];
  }

  private decodeTraceRoute(raw: unknown): DomainEvent[] {
    const p = raw as {
      from: number;
      to?: number;
      rxTime?: number;
      data?: { route?: readonly number[]; routeBack?: readonly number[] };
      payloadVariant?: {
        case?: string;
        value?: {
          portnum?: number;
          payload?: Uint8Array;
          dest?: number;
          source?: number;
          replyId?: number;
          requestId?: number;
        };
      };
    };

    let route: number[];
    let routeBack: number[] | undefined;
    let dataLayerDest: number | undefined;
    let dataLayerSource: number | undefined;
    let replyId: number | undefined;
    let requestId: number | undefined;

    if (p.payloadVariant?.case === 'decoded' && p.payloadVariant.value?.payload) {
      try {
        const rd = fromBinary(
          Mesh.RouteDiscoverySchema,
          p.payloadVariant.value.payload,
        ) as unknown as {
          route: readonly number[];
          routeBack: readonly number[];
        };
        route = boundedRoute(rd.route);
        routeBack = rd.routeBack ? boundedRoute(rd.routeBack) : undefined;
      } catch {
        // catch-no-log-ok non-traceroute payload on TRACEROUTE_APP
        return [];
      }
      const dp = p.payloadVariant.value;
      const rawDest = dp.dest;
      dataLayerDest = typeof rawDest === 'number' && Number.isFinite(rawDest) ? rawDest : undefined;
      const rawSource = dp.source;
      dataLayerSource =
        typeof rawSource === 'number' && Number.isFinite(rawSource) ? rawSource : undefined;
      const rawReply = dp.replyId;
      replyId = typeof rawReply === 'number' && Number.isFinite(rawReply) ? rawReply : undefined;
      const rawReq = dp.requestId;
      requestId = typeof rawReq === 'number' && Number.isFinite(rawReq) ? rawReq : undefined;
    } else if (p.data) {
      route = boundedRoute(p.data.route);
      routeBack = p.data.routeBack ? boundedRoute(p.data.routeBack) : undefined;
    } else {
      return [];
    }

    const from = normalizedNodeNum(p.from);
    if (from === undefined) return [];

    return [
      {
        type: 'trace_route',
        payload: {
          from,
          to: normalizedNodeNum(p.to) ?? dataLayerDest ?? 0,
          route,
          routeBack,
          timestamp: p.rxTime ? p.rxTime * 1000 : Date.now(),
          dataLayerDest,
          dataLayerSource,
          replyId,
          requestId,
        },
      },
    ];
  }

  private decodeChannel(raw: unknown): DomainEvent[] {
    const ch = raw as {
      index?: number;
      settings?: {
        name?: string;
        psk?: Uint8Array;
        uplinkEnabled?: boolean;
        downlinkEnabled?: boolean;
        moduleSettings?: { positionPrecision?: number };
      };
      role?: number;
    };
    const index = ch.index;
    if (!isFiniteNumber(index) || index < 0 || !Number.isInteger(index)) return [];
    const payload: ChannelEvent = {
      index,
      role: ch.role ?? 0,
      name: ch.settings?.name ?? '',
      psk: ch.settings?.psk ?? new Uint8Array([1]),
      uplinkEnabled: ch.settings?.uplinkEnabled ?? false,
      downlinkEnabled: ch.settings?.downlinkEnabled ?? false,
      positionPrecision: ch.settings?.moduleSettings?.positionPrecision ?? 0,
    };
    return [{ type: 'channel', payload }];
  }

  private decodeConfig(raw: unknown): DomainEvent[] {
    const cfg = raw as {
      payloadVariant?: {
        case?: string;
        value?: {
          gpsMode?: number;
          fixedPosition?: boolean;
          device_update_interval?: number;
          deviceUpdateInterval?: number;
          publicKey?: Uint8Array;
          privateKey?: Uint8Array;
          adminKey?: Uint8Array[];
          isManaged?: boolean;
          serialEnabled?: boolean;
          debugLogApiEnabled?: boolean;
          adminChannelEnabled?: boolean;
        };
      };
    };
    const events: DomainEvent[] = [];
    const variant = cfg.payloadVariant;
    if (!variant?.case || !variant.value) return events;

    if (variant.case === 'position' && variant.value.gpsMode != null) {
      const gpsPayload: DeviceGpsStateEvent = {
        gpsMode: variant.value.gpsMode,
        fixedPosition:
          typeof variant.value.fixedPosition === 'boolean' ? variant.value.fixedPosition : null,
      };
      events.push({ type: 'device_gps_state', payload: gpsPayload });
    }

    if (variant.case === 'telemetry') {
      const interval = variant.value.device_update_interval ?? variant.value.deviceUpdateInterval;
      if (typeof interval === 'number') {
        const tiPayload: TelemetryIntervalEvent = { interval };
        events.push({ type: 'telemetry_interval', payload: tiPayload });
      }
    }

    if (variant.case === 'security') {
      const v = variant.value;
      const secPayload: SecurityConfigEvent = {
        publicKey: v.publicKey ?? new Uint8Array(),
        privateKey: v.privateKey ?? new Uint8Array(),
        adminKey: v.adminKey ?? [],
        isManaged: v.isManaged ?? false,
        serialEnabled: v.serialEnabled ?? false,
        debugLogApiEnabled: v.debugLogApiEnabled ?? false,
        adminChannelEnabled: v.adminChannelEnabled ?? false,
      };
      events.push({ type: 'security_config', payload: secPayload });
    }

    events.push({
      type: 'meshtastic_config_slice',
      payload: { configCase: variant.case, value: variant.value },
    });

    return events;
  }

  private decodeModuleConfig(raw: unknown): DomainEvent[] {
    const cfg = raw as { payloadVariant?: { case?: string; value?: unknown } };
    if (!cfg.payloadVariant?.case) return [];
    const payload: ModuleConfigEvent = {
      configType: cfg.payloadVariant.case,
      value: cfg.payloadVariant.value,
    };
    return [{ type: 'module_config', payload }];
  }

  private decodeQueueStatus(raw: unknown): DomainEvent[] {
    const qs = raw as { free?: number; maxlen?: number };
    const payload: QueueStatusEvent = { free: qs.free ?? 0, maxlen: qs.maxlen ?? 0 };
    return [{ type: 'queue_status', payload }];
  }

  private decodeDeviceLog(raw: unknown): DomainEvent[] {
    const record = raw as { message?: string; source?: string; level?: number };
    const payload: DeviceLogEvent = {
      message: record.message ?? '',
      time: Date.now(),
      source: record.source ?? '',
      level: record.level ?? 0,
    };
    return [{ type: 'device_log', payload }];
  }

  private decodeRawPacket(raw: unknown): DomainEvent[] {
    const mp = raw as {
      id?: number;
      rxSnr?: number;
      rxRssi?: number;
      from?: number;
      hopLimit?: number;
      hopStart?: number;
      viaMqtt?: boolean;
      payloadVariant?: { case?: string; value?: { portnum?: number } };
    };
    const from = normalizedNodeNum(mp.from);
    if (!from) return [];
    try {
      const serialized = toBinary(Mesh.MeshPacketSchema, raw as never);
      if (serialized.byteLength > MAX_RAW_PACKET_BYTES) return [];
      const portLabel = this.rawPacketPortLabel(raw);
      const portnum =
        mp.payloadVariant?.case === 'decoded' &&
        typeof mp.payloadVariant.value?.portnum === 'number'
          ? mp.payloadVariant.value.portnum
          : undefined;
      const hopsAway = meshtasticComputedRfHopsAway(mp);
      const payload: RawPacketEntry = {
        ts: Date.now(),
        snr: mp.rxSnr ?? 0,
        rssi: mp.rxRssi ?? 0,
        raw: serialized,
        fromNodeId: from,
        portLabel,
        viaMqtt: mp.viaMqtt === true,
        isLocal: false,
        hopsAway,
        packetId: normalizedNodeNum(mp.id),
        hopLimit: mp.hopLimit,
        hopStart: mp.hopStart,
        portnum,
      };
      return [{ type: 'raw_packet', payload }];
    } catch {
      // catch-no-log-ok serialization failures are non-critical
      return [];
    }
  }

  private rawPacketPortLabel(packet: unknown): string {
    const p = packet as { payloadVariant?: { case?: string; value?: { portnum?: number } } };
    const variant = p.payloadVariant?.case;
    if (variant === 'decoded') {
      const portnum = p.payloadVariant?.value?.portnum;
      if (typeof portnum === 'number') {
        const found = Object.entries(Portnums.PortNum).find(([, v]) => v === portnum);
        return found ? found[0] : `PORT_${portnum}`;
      }
      return 'decoded';
    }
    if (variant === 'encrypted') return 'encrypted';
    return variant ?? '?';
  }

  private decodeDeviceStatus(raw: unknown): DomainEvent[] {
    const status = STATUS_CODE_MAP[raw as number] ?? 'connected';
    return [{ type: 'device_status', payload: { status } }];
  }

  private decodeDeviceMetadata(raw: unknown): DomainEvent[] {
    const packet = raw as {
      data?: { firmwareVersion?: string; hasWifi?: boolean; hasEthernet?: boolean };
    };
    const data = packet.data;
    const payload: DeviceMetadataEvent = {
      firmwareVersion: data?.firmwareVersion,
      hasWifi: data?.hasWifi,
      hasEthernet: data?.hasEthernet,
    };
    return [{ type: 'device_metadata', payload }];
  }

  private decodeNeighborInfo(raw: unknown): DomainEvent[] {
    const packet = raw as {
      data?: {
        nodeId?: number;
        neighbors?: { nodeId?: number; snr?: number; lastRxTime?: number }[];
      };
    };
    const data = packet.data;
    const nodeId = normalizedNodeNum(data?.nodeId);
    if (!nodeId) return [];
    const payload: NeighborInfoEvent = {
      nodeId,
      neighbors: (data?.neighbors ?? []).slice(0, MAX_NEIGHBOR_ENTRIES).map((n) => ({
        nodeId: normalizedNodeNum(n.nodeId) ?? 0,
        snr: isFiniteNumber(n.snr) ? n.snr : 0,
        lastRxTime: isFiniteNumber(n.lastRxTime) ? n.lastRxTime : 0,
      })),
      timestamp: Date.now(),
    };
    return [{ type: 'neighbor_info', payload }];
  }
}

/** Shared singleton — one instance per protocol type, used by every identity. */
export const meshtasticProtocol = new MeshtasticProtocol();
