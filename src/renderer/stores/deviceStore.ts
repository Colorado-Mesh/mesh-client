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
import { omitRecordKey } from './storeUtils';

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
  /** Full Meshtastic Config protobuf slices keyed by payloadVariant case (device, lora, …). */
  meshtasticConfigSlices: Record<string, unknown>;
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
  meshtasticConfigSlices: {},
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

export function setMeshtasticConfigSlice(id: IdentityId, configCase: string, value: unknown): void {
  useDeviceStore.setState((s) => {
    const rec = s.devices[id] ?? defaultRecord;
    return {
      devices: {
        ...s.devices,
        [id]: {
          ...rec,
          meshtasticConfigSlices: {
            ...rec.meshtasticConfigSlices,
            [configCase]: value,
          },
        },
      },
    };
  });
}

export function setSecurityConfig(id: IdentityId, securityConfig: SecurityConfig): void {
  patch(id, { securityConfig });
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

/** Replace the MeshCore channel list for an identity (runtime → deviceStore sync). */
export function setMeshcoreChannels(id: IdentityId, channels: MeshcoreChannelEvent[]): void {
  patch(id, {
    meshcoreChannels: [...channels].sort((a, b) => a.index - b.index),
  });
}

// --- Meshtastic per-port packet buffers ---

export function clearDeviceIdentity(id: IdentityId): void {
  useDeviceStore.setState((s) => ({
    devices: omitRecordKey(s.devices, id),
  }));
}

export function getDevice(id: IdentityId): DeviceRecord {
  return useDeviceStore.getState().devices[id] ?? defaultRecord;
}
