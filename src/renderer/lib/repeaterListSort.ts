import type { MeshCoreRepeaterStatus } from './meshcore/meshcoreHookTypes';
import { meshcoreTracePathLenToHops } from './meshcoreUtils';
import {
  effectiveLastHeardMs,
  getNodeStatus,
  mergeMeshcoreLastHeardFromAdvert,
  type NodeStatus,
  normalizeLastHeardMs,
} from './nodeStatus';
import type { PathRecord } from './pathHistoryTypes';
import { MS_PER_DAY } from './timeConstants';
import type { MeshNode } from './types';

export type RepeaterSortKey =
  'status' | 'name' | 'lastHeard' | 'snr' | 'rssi' | 'hops' | 'uptime' | 'airPct' | 'reliability';
export type RepeaterSortDir = 'asc' | 'desc';

export interface RepeaterSortPreference {
  key: RepeaterSortKey;
  dir: RepeaterSortDir;
}

export const DEFAULT_REPEATER_SORT: RepeaterSortPreference = {
  key: 'lastHeard',
  dir: 'desc',
};

const SIGNAL_MAX_AGE_MS = MS_PER_DAY;

export interface RepeaterContactSignal {
  node_id: number;
  last_snr: number | null;
  last_rssi: number | null;
  last_advert: number | null;
}

export interface RepeaterSignalPoint {
  ts: number;
  snr: number;
}

export interface PreparedRepeaterSortRow {
  node: MeshNode;
  favorited: boolean;
  nameLower: string;
  statusRank: number;
  lastHeardMs: number | null;
  snr: number | null;
  rssi: number | null;
  hops: number | null;
  uptimeSecs: number | null;
  airPct: number | null;
  reliabilityPct: number | null;
}

export interface RepeaterSortContext {
  statusByNodeId?: Map<number, MeshCoreRepeaterStatus>;
  contacts?: Map<number, RepeaterContactSignal>;
  signalHistory?: Map<number, RepeaterSignalPoint[]>;
  pathHistory?: Map<number, PathRecord[]>;
  tracePathLenByNodeId?: Map<number, number>;
  currentRouteHopByNodeId?: Map<number, number>;
  nodeStaleThresholdMs?: number;
  nodeOfflineThresholdMs?: number;
}

const STATUS_RANK: Record<NodeStatus, number> = {
  online: 2,
  stale: 1,
  offline: 0,
};

/** Default direction when switching columns (Last Heard = newest first). */
export function defaultRepeaterSortDir(key: RepeaterSortKey): RepeaterSortDir {
  return key === 'name' || key === 'hops' ? 'asc' : 'desc';
}

export function nextRepeaterSort(
  current: RepeaterSortPreference,
  clickedKey: RepeaterSortKey,
): RepeaterSortPreference {
  if (current.key === clickedKey) {
    return { key: current.key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: clickedKey, dir: defaultRepeaterSortDir(clickedKey) };
}

export function effectiveRepeaterLastAdvert(
  dbAdvert: number | null | undefined,
  nodeLastHeard: number | undefined,
): number | null {
  const merged = mergeMeshcoreLastHeardFromAdvert(dbAdvert ?? undefined, nodeLastHeard);
  return merged > 0 ? merged : null;
}

export function isRepeaterSignalRecent(lastAdvert: number | null | undefined): boolean {
  if (lastAdvert == null) return false;
  const advertMs = normalizeLastHeardMs(lastAdvert);
  if (!advertMs) return false;
  return Date.now() - advertMs < SIGNAL_MAX_AGE_MS;
}

function finiteNonZero(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value === 0) return null;
  return value;
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

export function resolveRepeaterSnr(
  node: MeshNode,
  status: MeshCoreRepeaterStatus | undefined,
  history?: RepeaterSignalPoint[],
  contacts?: Map<number, RepeaterContactSignal>,
): number | null {
  if (status !== undefined && Number.isFinite(status.lastSnr)) {
    return status.lastSnr;
  }
  const latestSignal = history && history.length > 0 ? history[history.length - 1] : undefined;
  if (latestSignal != null && Number.isFinite(latestSignal.snr)) {
    return latestSignal.snr;
  }
  const contactSignal = contacts?.get(node.node_id);
  if (
    contactSignal?.last_snr != null &&
    contactSignal.last_snr !== 0 &&
    isRepeaterSignalRecent(effectiveRepeaterLastAdvert(contactSignal.last_advert, node.last_heard))
  ) {
    return contactSignal.last_snr;
  }
  return finiteNonZero(node.snr);
}

export function resolveRepeaterRssi(
  node: MeshNode,
  status: MeshCoreRepeaterStatus | undefined,
  contacts?: Map<number, RepeaterContactSignal>,
): number | null {
  if (status !== undefined && Number.isFinite(status.lastRssi)) {
    return status.lastRssi;
  }
  const contactSignal = contacts?.get(node.node_id);
  if (
    contactSignal?.last_rssi != null &&
    contactSignal.last_rssi !== 0 &&
    isRepeaterSignalRecent(effectiveRepeaterLastAdvert(contactSignal.last_advert, node.last_heard))
  ) {
    return contactSignal.last_rssi;
  }
  return finiteNonZero(node.rssi);
}

export function resolveRepeaterReliability(paths: PathRecord[] | undefined): number | null {
  if (!paths?.length) return null;
  const total = paths.reduce((sum, p) => sum + p.successCount + p.failureCount, 0);
  if (total === 0) return null;
  const successes = paths.reduce((sum, p) => sum + p.successCount, 0);
  return (successes / total) * 100;
}

export function resolveRepeaterUptimeSecs(
  status: MeshCoreRepeaterStatus | undefined,
): number | null {
  const secs = status?.totalUpTimeSecs;
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return null;
  return secs;
}

export function resolveRepeaterAirPct(status: MeshCoreRepeaterStatus | undefined): number | null {
  const air = status?.totalAirTimeSecs;
  const up = status?.totalUpTimeSecs;
  if (air == null || up == null || !Number.isFinite(air) || !Number.isFinite(up) || up <= 0) {
    return null;
  }
  return (air / up) * 100;
}

export function resolveRepeaterHops(
  node: MeshNode,
  tracePathLen?: number,
  currentRouteHopCount?: number,
): number | null {
  if (tracePathLen != null && Number.isFinite(tracePathLen)) {
    return meshcoreTracePathLenToHops(tracePathLen);
  }
  if (currentRouteHopCount != null && Number.isFinite(currentRouteHopCount)) {
    return currentRouteHopCount;
  }
  return finiteOrNull(node.hops_away);
}

export function resolveRepeaterLastHeardMs(node: MeshNode): number | null {
  const heard = node.last_heard;
  if (!Number.isFinite(heard) || heard <= 0) return null;
  const ms = effectiveLastHeardMs(heard);
  return ms > 0 ? ms : null;
}

export function resolveRepeaterStatusRank(
  node: MeshNode,
  staleThresholdMs?: number,
  offlineThresholdMs?: number,
): number {
  return STATUS_RANK[getNodeStatus(node.last_heard, staleThresholdMs, offlineThresholdMs)];
}

function compareNullableNumber(a: number | null, b: number | null, sign: number): number | null {
  if (a == null && b == null) return null;
  if (a == null) return 1;
  if (b == null) return -1;
  return sign * (a - b);
}

export function prepareRepeaterSortRows(
  nodes: readonly MeshNode[],
  ctx: RepeaterSortContext = {},
): PreparedRepeaterSortRow[] {
  return nodes.map((node) => {
    const status = ctx.statusByNodeId?.get(node.node_id);
    const history = ctx.signalHistory?.get(node.node_id);
    const paths = ctx.pathHistory?.get(node.node_id);
    return {
      node,
      favorited: Boolean(node.favorited),
      nameLower: (node.long_name || '').toLowerCase(),
      statusRank: resolveRepeaterStatusRank(
        node,
        ctx.nodeStaleThresholdMs,
        ctx.nodeOfflineThresholdMs,
      ),
      lastHeardMs: resolveRepeaterLastHeardMs(node),
      snr: resolveRepeaterSnr(node, status, history, ctx.contacts),
      rssi: resolveRepeaterRssi(node, status, ctx.contacts),
      hops: resolveRepeaterHops(
        node,
        ctx.tracePathLenByNodeId?.get(node.node_id),
        ctx.currentRouteHopByNodeId?.get(node.node_id),
      ),
      uptimeSecs: resolveRepeaterUptimeSecs(status),
      airPct: resolveRepeaterAirPct(status),
      reliabilityPct: resolveRepeaterReliability(paths),
    };
  });
}

function comparePrepared(
  a: PreparedRepeaterSortRow,
  b: PreparedRepeaterSortRow,
  key: RepeaterSortKey,
  dir: RepeaterSortDir,
): number {
  if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
  const sign = dir === 'asc' ? 1 : -1;
  let cmp: number | null;
  switch (key) {
    case 'name':
      cmp = sign * a.nameLower.localeCompare(b.nameLower);
      break;
    case 'status':
      cmp = compareNullableNumber(a.statusRank, b.statusRank, sign);
      break;
    case 'lastHeard':
      cmp = compareNullableNumber(a.lastHeardMs, b.lastHeardMs, sign);
      break;
    case 'snr':
      cmp = compareNullableNumber(a.snr, b.snr, sign);
      break;
    case 'rssi':
      cmp = compareNullableNumber(a.rssi, b.rssi, sign);
      break;
    case 'hops':
      cmp = compareNullableNumber(a.hops, b.hops, sign);
      break;
    case 'uptime':
      cmp = compareNullableNumber(a.uptimeSecs, b.uptimeSecs, sign);
      break;
    case 'airPct':
      cmp = compareNullableNumber(a.airPct, b.airPct, sign);
      break;
    case 'reliability':
      cmp = compareNullableNumber(a.reliabilityPct, b.reliabilityPct, sign);
      break;
  }
  if (cmp != null && cmp !== 0) return cmp;
  return a.node.node_id - b.node.node_id;
}

export function sortPreparedRepeaterRows(
  rows: readonly PreparedRepeaterSortRow[],
  key: RepeaterSortKey,
  dir: RepeaterSortDir,
): PreparedRepeaterSortRow[] {
  const next = [...rows];
  next.sort((a, b) => comparePrepared(a, b, key, dir));
  return next;
}
