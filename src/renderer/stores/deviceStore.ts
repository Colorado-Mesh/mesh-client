import { create } from 'zustand';

import type { OurPosition } from '../lib/gpsSource';
import type {
  AutoaddConfigEvent,
  ContactRecord,
  DeviceSelfInfoEvent,
  MeshcoreChannelEvent,
  RawPacketEntry,
} from '../lib/protocols/Protocol';
import type { IdentityId } from '../lib/types';

export interface ChannelConfig {
  index: number;
  name: string;
  role: number;
  psk: Uint8Array;
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
  positionPrecision: number;
}

export interface SecurityConfig {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  adminKey: Uint8Array[];
  isManaged: boolean;
  serialEnabled: boolean;
  debugLogApiEnabled: boolean;
  adminChannelEnabled: boolean;
}

export interface DeviceOwner {
  id: string;
  longName: string;
  shortName: string;
}

export interface DeviceLogEntry {
  message: string;
  time: number;
  source: string;
  level: number;
}

export interface PortPacketEntry {
  from: number;
  data: Uint8Array;
  timestamp: number;
}

export interface PaxCounterEntry {
  from: number;
  count: number;
  timestamp: number;
}

export interface MapReportEntry {
  from: number;
  data: unknown;
  timestamp: number;
}

export interface MeshtasticPortBuffers {
  atak: Map<number, PortPacketEntry[]>;
  storeForward: Map<number, PortPacketEntry[]>;
  rangeTest: Map<number, PortPacketEntry[]>;
  serial: Map<number, PortPacketEntry[]>;
  remoteHardware: Map<number, PortPacketEntry[]>;
  ipTunnel: Map<number, PortPacketEntry[]>;
  detectionSensor: Map<number, PortPacketEntry[]>;
  audio: Map<number, PortPacketEntry[]>;
  zps: Map<number, PortPacketEntry[]>;
  simulator: Map<number, PortPacketEntry[]>;
  pax: Map<number, PaxCounterEntry>;
  mapReport: Map<number, MapReportEntry>;
  pingResponse: Map<number, PortPacketEntry>;
}

function emptyPortBuffers(): MeshtasticPortBuffers {
  return {
    atak: new Map(),
    storeForward: new Map(),
    rangeTest: new Map(),
    serial: new Map(),
    remoteHardware: new Map(),
    ipTunnel: new Map(),
    detectionSensor: new Map(),
    audio: new Map(),
    zps: new Map(),
    simulator: new Map(),
    pax: new Map(),
    mapReport: new Map(),
    pingResponse: new Map(),
  };
}

export interface DeviceRecord {
  channels: { index: number; name: string }[];
  channelConfigs: ChannelConfig[];
  moduleConfigs: Record<string, unknown>;
  securityConfig: SecurityConfig | null;
  deviceOwner: DeviceOwner | null;
  deviceGpsMode: number;
  deviceFixedPosition: boolean | null;
  telemetryDeviceUpdateInterval: number | null;
  ourPosition: OurPosition | null;
  rawPackets: RawPacketEntry[];
  deviceLogs: DeviceLogEntry[];
  ringtone: string | null;
  meshtasticPortBuffers: MeshtasticPortBuffers;
  meshcoreSelfInfo?: DeviceSelfInfoEvent;
  meshcoreContacts?: ContactRecord[];
  meshcoreAutoaddConfig?: AutoaddConfigEvent;
  meshcoreChannels?: MeshcoreChannelEvent[];
}

const defaultRecord: DeviceRecord = {
  channels: [],
  channelConfigs: [],
  moduleConfigs: {},
  securityConfig: null,
  deviceOwner: null,
  deviceGpsMode: 0,
  deviceFixedPosition: null,
  telemetryDeviceUpdateInterval: null,
  ourPosition: null,
  rawPackets: [],
  deviceLogs: [],
  ringtone: null,
  meshtasticPortBuffers: emptyPortBuffers(),
};

interface DeviceStoreState {
  devices: Record<IdentityId, DeviceRecord>;
}

const defaultState: DeviceStoreState = {
  devices: {},
};

export const useDeviceStore = create<DeviceStoreState>()(() => defaultState);

function patch(id: IdentityId, updates: Partial<DeviceRecord>): void {
  useDeviceStore.setState((s) => ({
    devices: {
      ...s.devices,
      [id]: { ...(s.devices[id] ?? defaultRecord), ...updates },
    },
  }));
}

export function setDeviceChannels(
  id: IdentityId,
  channels: DeviceRecord['channels'],
  channelConfigs: ChannelConfig[],
): void {
  patch(id, { channels, channelConfigs });
}

export function setModuleConfigs(id: IdentityId, moduleConfigs: Record<string, unknown>): void {
  patch(id, { moduleConfigs });
}

export function setSecurityConfig(id: IdentityId, securityConfig: SecurityConfig): void {
  patch(id, { securityConfig });
}

export function setDeviceOwner(id: IdentityId, deviceOwner: DeviceOwner): void {
  patch(id, { deviceOwner });
}

export function setDeviceGpsState(
  id: IdentityId,
  deviceGpsMode: number,
  deviceFixedPosition: boolean | null,
): void {
  patch(id, { deviceGpsMode, deviceFixedPosition });
}

export function setTelemetryDeviceUpdateInterval(id: IdentityId, interval: number | null): void {
  patch(id, { telemetryDeviceUpdateInterval: interval });
}

export function setOurPosition(id: IdentityId, ourPosition: OurPosition | null): void {
  patch(id, { ourPosition });
}

export function appendRawPacket(id: IdentityId, entry: RawPacketEntry): void {
  const MAX = 2500;
  useDeviceStore.setState((s) => {
    const prev = (s.devices[id] ?? defaultRecord).rawPackets;
    const next = prev.length >= MAX ? prev.slice(-(MAX - 1)) : prev;
    return {
      devices: {
        ...s.devices,
        [id]: { ...(s.devices[id] ?? defaultRecord), rawPackets: [...next, entry] },
      },
    };
  });
}

export function clearRawPackets(id: IdentityId): void {
  patch(id, { rawPackets: [] });
}

export function appendDeviceLog(id: IdentityId, entry: DeviceLogEntry): void {
  const MAX = 500;
  useDeviceStore.setState((s) => {
    const prev = (s.devices[id] ?? defaultRecord).deviceLogs;
    const next = prev.length >= MAX ? prev.slice(-(MAX - 1)) : prev;
    return {
      devices: {
        ...s.devices,
        [id]: { ...(s.devices[id] ?? defaultRecord), deviceLogs: [...next, entry] },
      },
    };
  });
}

export function setRingtone(id: IdentityId, ringtone: string | null): void {
  patch(id, { ringtone });
}

// --- MeshCore-side device state setters (PacketRouter writes these on
// device_self_info / device_contacts / device_autoadd / meshcore_channel
// events). Fields live on DeviceRecord as optional meshcore-named fields
// because deviceStore is domain-keyed, not protocol-split. ---

export function setMeshcoreSelfInfo(id: IdentityId, info: DeviceSelfInfoEvent): void {
  patch(id, { meshcoreSelfInfo: info });
}

export function setMeshcoreContacts(id: IdentityId, contacts: ContactRecord[]): void {
  patch(id, { meshcoreContacts: contacts });
}

export function setMeshcoreAutoaddConfig(id: IdentityId, cfg: AutoaddConfigEvent): void {
  patch(id, { meshcoreAutoaddConfig: cfg });
}

export function upsertMeshcoreChannel(id: IdentityId, ch: MeshcoreChannelEvent): void {
  useDeviceStore.setState((s) => {
    const rec = s.devices[id] ?? defaultRecord;
    const prev = rec.meshcoreChannels ?? [];
    const idx = prev.findIndex((c) => c.index === ch.index);
    const next = idx >= 0 ? prev.map((c, i) => (i === idx ? ch : c)) : [...prev, ch];
    return {
      devices: {
        ...s.devices,
        [id]: { ...rec, meshcoreChannels: next.sort((a, b) => a.index - b.index) },
      },
    };
  });
}

// --- Meshtastic per-port packet buffers ---

const MAX_PORT_BUFFER = 200;

type ArrayPort =
  | 'atak'
  | 'storeForward'
  | 'rangeTest'
  | 'serial'
  | 'remoteHardware'
  | 'ipTunnel'
  | 'detectionSensor'
  | 'audio'
  | 'zps'
  | 'simulator';

type ScalarPort = 'pax' | 'mapReport' | 'pingResponse';

export function appendPortPacket(
  id: IdentityId,
  port: ArrayPort,
  nodeId: number,
  entry: PortPacketEntry,
): void {
  useDeviceStore.setState((s) => {
    const rec = s.devices[id] ?? defaultRecord;
    const buffers = rec.meshtasticPortBuffers;
    const next = new Map(buffers[port]);
    const list = next.get(nodeId) ?? [];
    const trimmed = list.length >= MAX_PORT_BUFFER ? list.slice(-(MAX_PORT_BUFFER - 1)) : list;
    next.set(nodeId, [...trimmed, entry]);
    return {
      devices: {
        ...s.devices,
        [id]: {
          ...rec,
          meshtasticPortBuffers: { ...buffers, [port]: next },
        },
      },
    };
  });
}

export function setPortScalar(
  id: IdentityId,
  port: 'pingResponse',
  nodeId: number,
  entry: PortPacketEntry,
): void;
export function setPortScalar(
  id: IdentityId,
  port: 'pax',
  nodeId: number,
  entry: PaxCounterEntry,
): void;
export function setPortScalar(
  id: IdentityId,
  port: 'mapReport',
  nodeId: number,
  entry: MapReportEntry,
): void;
export function setPortScalar(
  id: IdentityId,
  port: ScalarPort,
  nodeId: number,
  entry: PortPacketEntry | PaxCounterEntry | MapReportEntry,
): void {
  useDeviceStore.setState((s) => {
    const rec = s.devices[id] ?? defaultRecord;
    const buffers = rec.meshtasticPortBuffers;
    const next = new Map(buffers[port] as Map<number, typeof entry>);
    next.set(nodeId, entry);
    return {
      devices: {
        ...s.devices,
        [id]: {
          ...rec,
          meshtasticPortBuffers: { ...buffers, [port]: next as never },
        },
      },
    };
  });
}

export function clearDeviceIdentity(id: IdentityId): void {
  useDeviceStore.setState((s) => {
    const { [id]: _removed, ...rest } = s.devices;
    return { devices: rest };
  });
}

export function getDevice(id: IdentityId): DeviceRecord {
  return useDeviceStore.getState().devices[id] ?? defaultRecord;
}
