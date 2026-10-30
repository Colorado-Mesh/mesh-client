import type { LiveMapProtocol } from '@/shared/liveMapWindow';

import type { GpsSource, OurPosition } from '../gpsSource';
import type { RxPacketEntry } from '../meshcore/meshcoreHookTypes';
import type { MeshtasticRawPacketEntry } from '../rawPacketLogConstants';
import { LIVE_TRAFFIC_MAX_PACKETS, type LiveTrafficNode } from './liveTrafficModel';

/** id, long name, short name, latitude, longitude, public key: what traffic geometry reads. */
export type LiveMapNodeRow = [number, string, string, number | null, number | null, string | null];

/**
 * Packet and node state relayed from the main window to a pop-out. Nodes and public keys are
 * sent only when they change, or when a pop-out asks for a full snapshot; packets are always the
 * newest window the traffic builders read.
 */
export interface LiveMapSnapshot {
  myNodeNum: number;
  ourPosition: OurPosition | null;
  nodes?: LiveMapNodeRow[];
  pubKeys?: [number, Uint8Array][];
  meshcorePackets?: RxPacketEntry[];
  meshtasticPackets?: MeshtasticRawPacketEntry[];
}

export interface LiveMapSnapshotInput {
  nodes: ReadonlyMap<number, LiveTrafficNode>;
  myNodeNum: number;
  ourPosition?: OurPosition | null;
  meshcorePackets?: readonly RxPacketEntry[];
  meshtasticPackets?: readonly MeshtasticRawPacketEntry[];
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>;
}

/**
 * Live traffic inputs as the pop-out window holds them between snapshots. Only the window
 * protocol's packet log is set, which is how the traffic panel tells the protocols apart.
 */
export interface LiveMapWindowData {
  myNodeNum: number;
  ourPosition: OurPosition | null;
  nodes: ReadonlyMap<number, LiveTrafficNode>;
  pubKeyByNodeId: ReadonlyMap<number, Uint8Array>;
  meshcorePackets?: readonly RxPacketEntry[];
  meshtasticPackets?: readonly MeshtasticRawPacketEntry[];
}

const PACKET_LOG: Record<LiveMapProtocol, 'meshcorePackets' | 'meshtasticPackets'> = {
  meshcore: 'meshcorePackets',
  meshtastic: 'meshtasticPackets',
};

export function emptyLiveMapWindowData(protocol: LiveMapProtocol): LiveMapWindowData {
  return {
    myNodeNum: 0,
    ourPosition: null,
    nodes: new Map(),
    pubKeyByNodeId: new Map(),
    [PACKET_LOG[protocol]]: [],
  };
}

const GPS_SOURCES: readonly GpsSource[] = ['device', 'browser', 'ip', 'static'];

export function buildLiveMapSnapshot(
  input: LiveMapSnapshotInput,
  include: { nodes: boolean; pubKeys: boolean },
): LiveMapSnapshot {
  const snapshot: LiveMapSnapshot = {
    myNodeNum: input.myNodeNum,
    ourPosition: input.ourPosition
      ? { lat: input.ourPosition.lat, lon: input.ourPosition.lon, source: input.ourPosition.source }
      : null,
  };
  if (include.nodes) {
    snapshot.nodes = [...input.nodes].map(([id, node]) => [
      id,
      node.long_name,
      node.short_name,
      node.latitude,
      node.longitude,
      node.public_key_hex ?? null,
    ]);
  }
  if (include.pubKeys) snapshot.pubKeys = [...(input.pubKeyByNodeId ?? [])];
  if (input.meshcorePackets)
    snapshot.meshcorePackets = input.meshcorePackets.slice(-LIVE_TRAFFIC_MAX_PACKETS);
  if (input.meshtasticPackets)
    snapshot.meshtasticPackets = input.meshtasticPackets.slice(-LIVE_TRAFFIC_MAX_PACKETS);
  return snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function optionalCoordinate(value: unknown): number | null {
  return finiteNumber(value) ? value : null;
}

function parsePosition(value: unknown): OurPosition | null {
  if (!isRecord(value) || !finiteNumber(value.lat) || !finiteNumber(value.lon)) return null;
  const source = GPS_SOURCES.find((candidate) => candidate === value.source);
  return source ? { lat: value.lat, lon: value.lon, source } : null;
}

function parseNodes(value: unknown): Map<number, LiveTrafficNode> | undefined {
  if (!Array.isArray(value)) return undefined;
  const nodes = new Map<number, LiveTrafficNode>();
  for (const row of value as unknown[]) {
    if (!Array.isArray(row)) continue;
    const [id, longName, shortName, lat, lon, publicKey] = row as unknown[];
    if (!finiteNumber(id)) continue;
    nodes.set(id, {
      long_name: typeof longName === 'string' ? longName : '',
      short_name: typeof shortName === 'string' ? shortName : '',
      latitude: optionalCoordinate(lat),
      longitude: optionalCoordinate(lon),
      ...(typeof publicKey === 'string' ? { public_key_hex: publicKey } : {}),
    });
  }
  return nodes;
}

function parsePubKeys(value: unknown): Map<number, Uint8Array> | undefined {
  if (!Array.isArray(value)) return undefined;
  const keys = new Map<number, Uint8Array>();
  for (const entry of value as unknown[]) {
    if (Array.isArray(entry) && finiteNumber(entry[0]) && entry[1] instanceof Uint8Array)
      keys.set(entry[0], entry[1]);
  }
  return keys;
}

/** The traffic builders index raw bytes and timestamps; entries without them are skipped. */
function parsePackets(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return (value as unknown[])
    .slice(-LIVE_TRAFFIC_MAX_PACKETS)
    .filter(
      (packet) => isRecord(packet) && finiteNumber(packet.ts) && packet.raw instanceof Uint8Array,
    );
}

/**
 * Merge one relayed snapshot into the pop-out's data. Only the packet log the data already holds
 * is read. Fields a snapshot omits keep their previous value; a malformed snapshot leaves the
 * data unchanged.
 */
export function applyLiveMapSnapshot(
  current: LiveMapWindowData,
  value: unknown,
): LiveMapWindowData {
  if (!isRecord(value) || !finiteNumber(value.myNodeNum)) return current;
  const next: LiveMapWindowData = {
    myNodeNum: value.myNodeNum,
    ourPosition: parsePosition(value.ourPosition),
    nodes: parseNodes(value.nodes) ?? current.nodes,
    pubKeyByNodeId: parsePubKeys(value.pubKeys) ?? current.pubKeyByNodeId,
  };
  if (current.meshcorePackets)
    next.meshcorePackets =
      (parsePackets(value.meshcorePackets) as RxPacketEntry[] | undefined) ??
      current.meshcorePackets;
  if (current.meshtasticPackets)
    next.meshtasticPackets =
      (parsePackets(value.meshtasticPackets) as MeshtasticRawPacketEntry[] | undefined) ??
      current.meshtasticPackets;
  return next;
}
