import { create, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
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
import { meshtasticHwModelName } from '../hardwareModels';
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

// --- Re-exported types for callers that previously imported from this module ---

export interface MeshtasticRawPacketEntry {
  ts: number;
  snr: number;
  rssi: number;
  raw: Uint8Array;
  fromNodeId: number | null;
  portLabel: string;
  viaMqtt: boolean;
  isLocal?: boolean;
}

const STATUS_CODE_MAP: Record<number, string> = {
  1: 'connecting',
  2: 'disconnected',
  3: 'connecting',
  4: 'connecting',
  5: 'connected',
  6: 'connecting',
  7: 'configured',
  8: 'stale',
};

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
        return reconnectSerial();
      case 'http':
        return createConnection('http', params.host);
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

    push(
      device.events.onDeviceStatus.subscribe((status) => {
        fire(this.decodeDeviceStatus(status));
      }),
    );
    push(
      device.events.onMeshPacket.subscribe((packet) => {
        if (packet.payloadVariant.case === 'decoded') {
          const portnum = Number((packet.payloadVariant.value as { portnum?: unknown }).portnum);
          if (portnum === Number(Portnums.PortNum.TEXT_MESSAGE_APP)) {
            fire(this.decodeTextMessage(packet));
          } else if (portnum === Number(Portnums.PortNum.TRACEROUTE_APP)) {
            fire(this.decodeTraceRoute(packet));
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
        fire(this.decodeTraceRoute(p));
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
        if (info.myNodeNum > 0) {
          emit({ type: 'node_info', payload: { nodeId: info.myNodeNum } });
        }
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
      default:
        throw new UnsupportedOperation(`meshtastic signature for ${params.type}`);
    }
  }

  // --- Outbound ---

  async sendMessage(handle: unknown, opts: SendMessageOptions): Promise<SendResult> {
    const device = handle as MeshDevice;
    const dest: number | 'broadcast' = opts.destination ?? 'broadcast';
    const result = await device.sendText(opts.text, dest, true, opts.channelIndex ?? 0);
    const packetId = typeof result === 'number' ? result : undefined;
    return { packetId };
  }

  async sendPosition(handle: unknown, opts: SendPositionOptions): Promise<void> {
    const device = handle as MeshDevice;
    await device.setPosition(
      create(Mesh.PositionSchema, {
        latitudeI: Math.round(opts.latitude * 1e7),
        longitudeI: Math.round(opts.longitude * 1e7),
        altitude: opts.altitude ?? 0,
        time: Math.floor(Date.now() / 1000),
      }) as Parameters<MeshDevice['setPosition']>[0],
    );
  }

  async sendTraceRoute(handle: unknown, nodeId: number): Promise<void> {
    const device = handle as MeshDevice;
    await device.traceRoute(nodeId);
  }

  async sendWaypoint(handle: unknown, opts: SendWaypointOptions): Promise<void> {
    const device = handle as MeshDevice;
    await device.sendWaypoint(
      create(Mesh.WaypointSchema, {
        id: opts.id,
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
    await device.sendWaypoint(
      create(Mesh.WaypointSchema, { id, expire: 1 }) as Parameters<MeshDevice['sendWaypoint']>[0],
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
    await device.sendText(
      String.fromCodePoint(safeScalar),
      'broadcast',
      true,
      channelIndex,
      replyId,
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
    await (handle as MeshDevice).setConfig(config as never);
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
    await (handle as { setModuleConfig: (c: unknown) => Promise<void> }).setModuleConfig(config);
  }

  async setCannedMessages(handle: unknown, messages: string[]): Promise<void> {
    await (
      handle as { setCannedMessages: (m: { messages: string }) => Promise<void> }
    ).setCannedMessages({ messages: messages.join('\n') });
  }

  async setRingtone(handle: unknown, ringtone: string): Promise<void> {
    const msg = create(Admin.AdminMessageSchema, {
      payloadVariant: { case: 'setRingtoneMessage', value: ringtone },
    });
    await (
      handle as {
        sendPacket: (b: Uint8Array, p: number, t: string) => Promise<void>;
      }
    ).sendPacket(toBinary(Admin.AdminMessageSchema, msg), Portnums.PortNum.ADMIN_APP, 'self');
  }

  // --- GPS / position ---

  async sendPositionToDevice(
    handle: unknown,
    lat: number,
    lon: number,
    alt?: number,
  ): Promise<void> {
    await (handle as MeshDevice).setPosition(
      create(Mesh.PositionSchema, {
        latitudeI: Math.round(lat * 1e7),
        longitudeI: Math.round(lon * 1e7),
        altitude: alt ?? 0,
        time: Math.floor(Date.now() / 1000),
      }) as Parameters<MeshDevice['setPosition']>[0],
    );
  }

  async requestPosition(handle: unknown, nodeId: number): Promise<void> {
    await (handle as MeshDevice).requestPosition(nodeId);
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
    };
    if (p.payloadVariant?.case !== 'decoded') return [];
    const data = p.payloadVariant.value;
    const hopCount =
      p.hopStart != null && p.hopLimit != null && p.hopStart >= p.hopLimit
        ? p.hopStart - p.hopLimit
        : undefined;
    const rawReplyId = data.replyId ?? data.reply_id;
    return [
      {
        type: 'text_message',
        payload: {
          id: String(p.id ?? 0),
          from: p.from,
          to: p.to,
          payload: new TextDecoder().decode(data.payload),
          channelIndex: p.channel ?? 0,
          timestamp: p.rxTime ? p.rxTime * 1000 : Date.now(),
          rxSnr: p.rxSnr,
          rxRssi: p.rxRssi,
          hopCount,
          replyTo: rawReplyId ? String(rawReplyId) : undefined,
          tapback: data.emoji != null ? data.emoji !== 0 : undefined,
        },
      },
    ];
  }

  private decodeNodeInfo(raw: unknown): DomainEvent[] {
    const p = raw as {
      num?: number;
      user?: { longName?: string; shortName?: string; hwModel?: number; role?: number };
      lastHeard?: number;
    };
    if (!p.num) return [];
    return [
      {
        type: 'node_info',
        payload: {
          nodeId: p.num,
          longName: p.user?.longName,
          shortName: p.user?.shortName,
          hwModel: p.user?.hwModel != null ? meshtasticHwModelName(p.user.hwModel) : undefined,
          role: p.user?.role,
          lastHeardAt: p.lastHeard,
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
    return [
      {
        type: 'position',
        payload: {
          nodeId: p.from,
          latitude: (p.data?.latitudeI ?? 0) / 1e7,
          longitude: (p.data?.longitudeI ?? 0) / 1e7,
          altitude: p.data?.altitude,
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
        variant?: { value?: Record<string, unknown> };
        deviceMetrics?: Record<string, unknown>;
      };
    };
    const m: Record<string, unknown> = p.data?.variant?.value ?? p.data?.deviceMetrics ?? {};
    return [
      {
        type: 'telemetry',
        payload: {
          nodeId: p.from,
          timestamp: p.rxTime ? p.rxTime * 1000 : Date.now(),
          batteryLevel: m.batteryLevel as number | undefined,
          voltage: m.voltage as number | undefined,
          channelUtilization: m.channelUtilization as number | undefined,
          airUtilTx: m.airUtilTx as number | undefined,
          temperature: m.temperature as number | undefined,
          relativeHumidity: m.relativeHumidity as number | undefined,
          barometricPressure: m.barometricPressure as number | undefined,
          iaq: m.iaq as number | undefined,
        },
      },
    ];
  }

  private decodeWaypoint(raw: unknown): DomainEvent[] {
    const p = raw as {
      from: number;
      rxTime?: number;
      data: {
        id?: number;
        name?: string;
        latitudeI?: number;
        longitudeI?: number;
        description?: string;
        lockedTo?: number;
        expire?: number;
      };
    };
    if (!p.data?.id) return [];
    return [
      {
        type: 'waypoint',
        payload: {
          id: p.data.id,
          name: p.data.name ?? '',
          description: p.data.description,
          latitude: (p.data.latitudeI ?? 0) / 1e7,
          longitude: (p.data.longitudeI ?? 0) / 1e7,
          lockedTo: p.data.lockedTo,
          expire: p.data.expire,
          from: p.from,
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
      data: { route?: readonly number[]; routeBack?: readonly number[] };
    };
    return [
      {
        type: 'trace_route',
        payload: {
          from: p.from,
          to: p.to ?? 0,
          route: Array.from(p.data?.route ?? []),
          routeBack: p.data?.routeBack ? Array.from(p.data.routeBack) : undefined,
          timestamp: p.rxTime ? p.rxTime * 1000 : Date.now(),
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
    if (ch.index === undefined) return [];
    const payload: ChannelEvent = {
      index: ch.index,
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
      viaMqtt?: boolean;
    };
    if (!mp.from) return [];
    try {
      const serialized = toBinary(Mesh.MeshPacketSchema, raw as never);
      const portLabel = this.rawPacketPortLabel(raw);
      const payload: RawPacketEntry = {
        ts: Date.now(),
        snr: mp.rxSnr ?? 0,
        rssi: mp.rxRssi ?? 0,
        raw: serialized,
        fromNodeId: mp.from,
        portLabel,
        viaMqtt: mp.viaMqtt === true,
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
    const packet = raw as { data?: { firmwareVersion?: string } };
    const payload: DeviceMetadataEvent = { firmwareVersion: packet.data?.firmwareVersion };
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
    if (!data?.nodeId) return [];
    const payload: NeighborInfoEvent = {
      nodeId: data.nodeId,
      neighbors: (data.neighbors ?? []).map((n) => ({
        nodeId: n.nodeId ?? 0,
        snr: n.snr ?? 0,
        lastRxTime: n.lastRxTime ?? 0,
      })),
      timestamp: Date.now(),
    };
    return [{ type: 'neighbor_info', payload }];
  }
}

/** Shared singleton — one instance per protocol type, used by every identity. */
export const meshtasticProtocol = new MeshtasticProtocol();
