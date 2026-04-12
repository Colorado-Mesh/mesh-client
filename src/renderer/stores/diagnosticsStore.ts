import { create } from 'zustand';

import { getAppSettingsRaw, mergeAppSetting } from '../lib/appSettingsStorage';
import {
  DEFAULT_RF_DIAGNOSTIC_MAX_AGE_MS,
  DEFAULT_ROUTING_DIAGNOSTIC_MAX_AGE_MS,
  diagnosticRowsToRoutingMap,
  pruneDiagnosticRowsByAge,
  replaceRfRowsForNode,
  replaceRoutingRowsFromMap,
} from '../lib/diagnostics/diagnosticRows';
import {
  diagnoseConnectedNode,
  diagnoseOtherNode,
  hasLocalStatsData,
  resetCuSpikeCooldown,
} from '../lib/diagnostics/RFDiagnosticEngine';
import { analyzeNode } from '../lib/diagnostics/RoutingDiagnosticEngine';
import {
  classifyProximity,
  type PacketClass,
  RollingRateCounter,
} from '../lib/foreignLoraDetection';
import type { GpsSource } from '../lib/gpsSource';
import { isLowAccuracyPosition } from '../lib/gpsSource';
import { parseStoredJson } from '../lib/parseStoredJson';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type {
  DiagnosticRow,
  HopHistoryPoint,
  MeshNode,
  NodeAnomaly,
  RfDiagnosticRow,
} from '../lib/types';
import { rfRowId } from '../lib/types';

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

/** `path_snrs` column is JSON array of numbers; tolerate legacy or corrupt DB values. */
function meshcoreTracePathSnrsFromDbJson(raw: string | null | undefined): number[] {
  if (raw == null || raw === '') return [];
  try {
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  } catch {
    // catch-no-log-ok corrupt JSON in DB column; treat as empty SNR list
    return [];
  }
}

export interface PacketPath {
  transport: 'rf' | 'mqtt';
  snr?: number;
  rssi?: number;
  timestamp: number;
}

export interface PacketRecord {
  packetId: number;
  fromNodeId: number;
  firstSeen: number;
  lastSeen: number;
  paths: PacketPath[];
}

export interface NodeRedundancy {
  maxPaths: number;
  score: number; // 0-100: min(round((maxPaths-1)/3 * 100), 100)
  recentPackets: PacketRecord[]; // last 20 packets
}

export const FOREIGN_LORA_WINDOW_MS = 90 * 60 * 1000; // 90 minutes

export interface ForeignLoraDetection {
  detectedAt: number;
  rssi?: number;
  snr?: number;
  proximity: 'very-close' | 'nearby' | 'distant' | 'unknown';
  packetClass: PacketClass;
  count: number;
  lastSenderId?: number;
  longName?: string;
}

/** Key for per-sender detection: "meshtastic:<id>", "meshcore", or "unknown". */
function foreignLoraSenderKey(packetClass: PacketClass, senderId?: number): string {
  if (packetClass === 'meshtastic' && senderId != null) return `meshtastic:${senderId}`;
  if (packetClass === 'meshcore') return 'meshcore';
  return 'unknown';
}

/** Foreign LoRa condition strings — used to surgically replace only these rows. */
const FOREIGN_LORA_CONDITIONS = new Set([
  'MeshCore Activity Detected',
  'Meshtastic Traffic Detected',
  'Unknown LoRa Traffic',
  'Potential MeshCore Repeater Conflict',
]);

/** Module-level rate counter for MeshCore-class packets (Meshtastic mode). */
const meshcoreRateCounter = new RollingRateCounter(60_000);

/** Last RF row update time per `nodeId:packetClass` key (5-min cooldown). */
const rfRowCooldowns = new Map<string, number>();

export type EnvMode = 'standard' | 'city' | 'canyon';

const ENV_PARAMS: Record<EnvMode, { mult: number; hops: number }> = {
  standard: { mult: 1.0, hops: 2 },
  city: { mult: 1.6, hops: 3 },
  canyon: { mult: 2.6, hops: 4 },
};

function getEnvParams(
  envMode: EnvMode,
  isLowAccuracy: boolean,
): { distanceMultiplier: number; hopsThreshold: number } {
  const { mult, hops } = ENV_PARAMS[envMode];
  return {
    distanceMultiplier: isLowAccuracy ? mult * 2 : mult,
    hopsThreshold: hops,
  };
}

/** CU samples for spike detection (connected node); pruned to 24h in processNodeUpdate */
export interface CuSample {
  t: number;
  cu: number;
}

export function computeCuStats24h(samples: CuSample[]): {
  average: number;
  sampleCount: number;
  spanMs: number;
} | null {
  if (samples.length === 0) return null;
  const now = Date.now();
  const pruned = samples.filter((s) => s.t > now - TWENTY_FOUR_HOURS);
  if (pruned.length === 0) return null;
  const sum = pruned.reduce((a, s) => a + s.cu, 0);
  const oldest = pruned.reduce((m, s) => Math.min(m, s.t), pruned[0].t);
  const newest = pruned.reduce((m, s) => Math.max(m, s.t), pruned[0].t);
  return {
    average: sum / pruned.length,
    sampleCount: pruned.length,
    spanMs: newest - oldest,
  };
}

const DIAGNOSTIC_ROWS_STORAGE_KEY = 'mesh-client:diagnosticRowsSnapshot';
const PERSIST_DEBOUNCE_MS = 2500;

interface DiagnosticRowsSnapshot {
  v: 1;
  savedAt: number;
  rows: DiagnosticRow[];
}

function isValidDiagnosticRow(r: unknown): r is DiagnosticRow {
  if (r == null || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  if (o.kind === 'routing') {
    return (
      typeof o.id === 'string' &&
      typeof o.nodeId === 'number' &&
      typeof o.type === 'string' &&
      typeof o.severity === 'string' &&
      typeof o.description === 'string' &&
      typeof o.detectedAt === 'number'
    );
  }
  if (o.kind === 'rf') {
    return (
      typeof o.id === 'string' &&
      typeof o.nodeId === 'number' &&
      typeof o.condition === 'string' &&
      typeof o.cause === 'string' &&
      typeof o.severity === 'string' &&
      typeof o.detectedAt === 'number'
    );
  }
  return false;
}

/** Routing diagnostic max age from app settings (hours); default 24. */
function loadRoutingDiagnosticMaxAgeMs(): number {
  const raw = getAppSettingsRaw();
  const o = parseStoredJson<{ diagnosticRowsMaxAgeHours?: number }>(
    raw,
    'diagnosticsStore loadRoutingDiagnosticMaxAgeMs',
  );
  const h = o?.diagnosticRowsMaxAgeHours;
  if (typeof h === 'number' && Number.isFinite(h) && h >= 1 && h <= 168) {
    return Math.round(h * 60 * 60 * 1000);
  }
  return DEFAULT_ROUTING_DIAGNOSTIC_MAX_AGE_MS;
}

/** Current routing max-age setting in hours (1–168), for UI. */
function loadDiagnosticRowsMaxAgeHours(): number {
  const ms = loadRoutingDiagnosticMaxAgeMs();
  const h = Math.round(ms / (60 * 60 * 1000));
  if (h >= 1 && h <= 168) return h;
  return 24;
}

function loadDiagnosticRowsSnapshot(): { rows: DiagnosticRow[]; savedAt: number } | null {
  const raw = localStorage.getItem(DIAGNOSTIC_ROWS_STORAGE_KEY);
  const parsed = parseStoredJson<DiagnosticRowsSnapshot>(
    raw,
    'diagnosticsStore loadDiagnosticRowsSnapshot',
  );
  if (parsed?.v !== 1 || !Array.isArray(parsed.rows)) return null;
  let rows = parsed.rows.filter(isValidDiagnosticRow);
  const droppedCount = parsed.rows.length - rows.length;
  if (droppedCount > 0) {
    console.warn(`[diagnosticsStore] dropped ${droppedCount} invalid diagnostic rows on load`);
  }
  if (rows.length === 0 && parsed.rows.length > 0) return null;
  const now = Date.now();
  rows = pruneDiagnosticRowsByAge(
    rows,
    now,
    loadRoutingDiagnosticMaxAgeMs(),
    DEFAULT_RF_DIAGNOSTIC_MAX_AGE_MS,
  );
  if (rows.length === 0) return null;
  return { rows, savedAt: parsed.savedAt };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function clearPersistedDiagnosticRowsSnapshot(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    localStorage.removeItem(DIAGNOSTIC_ROWS_STORAGE_KEY);
  } catch {
    // catch-no-log-ok localStorage unavailable — non-critical diagnostic row cleanup
  }
}

function schedulePersistDiagnosticRows(getRows: () => DiagnosticRow[]): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    let rows = getRows();
    const now = Date.now();
    rows = pruneDiagnosticRowsByAge(
      rows,
      now,
      loadRoutingDiagnosticMaxAgeMs(),
      DEFAULT_RF_DIAGNOSTIC_MAX_AGE_MS,
    );
    try {
      if (rows.length === 0) {
        localStorage.removeItem(DIAGNOSTIC_ROWS_STORAGE_KEY);
        return;
      }
      const payload: DiagnosticRowsSnapshot = {
        v: 1,
        savedAt: now,
        rows,
      };
      localStorage.setItem(DIAGNOSTIC_ROWS_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('[diagnosticsStore] persist diagnosticRows failed', e);
    }
  }, PERSIST_DEBOUNCE_MS);
}

interface DiagnosticsState {
  /** Routing + RF findings as table rows (replaces anomalies map). */
  diagnosticRows: DiagnosticRow[];
  /** When non-null, rows were restored from disk (savedAt from snapshot) — clear on first live update. */
  diagnosticRowsRestoredAt: number | null;
  hopHistory: Map<number, HopHistoryPoint[]>;
  /** Per-node channel_utilization samples (24h rolling) for CU spike detection */
  cuHistory: Map<number, CuSample[]>;
  packetStats: Map<number, { total: number; duplicates: number }>;
  packetCache: Map<number, PacketRecord>;
  nodeRedundancy: Map<number, NodeRedundancy>;
  congestionHalosEnabled: boolean;
  anomalyHalosEnabled: boolean;
  ignoreMqttEnabled: boolean;
  mqttIgnoredNodes: Set<number>;
  ourPositionSource: GpsSource | null;
  envMode: EnvMode;
  /** Session-only: cross-protocol foreign LoRa detections. nodeId -> senderKey -> detection (90-min window). */
  foreignLoraDetections: Map<number, Map<string, ForeignLoraDetection>>;
  /** MeshCore hop history from database (single record per node, upsert on newer timestamp). */
  meshcoreHopHistory: Map<
    number,
    { timestamp: number; hops: number | null; snr: number | null; rssi: number | null }
  >;
  /** Detections for a node in the last 90 minutes, sorted by detectedAt desc. */
  getForeignLoraDetectionsList(nodeId: number): ForeignLoraDetection[];
  /** MeshCore trace history from database (up to 5 records per node). */
  meshcoreTraceHistory: Map<
    number,
    {
      id: number;
      timestamp: number;
      pathLen: number | null;
      pathSnrs: number[];
      lastSnr: number | null;
      tag: number | null;
    }[]
  >;
  processNodeUpdate(
    node: MeshNode,
    homeNode: MeshNode | null,
    myNodeNum?: number,
    capabilities?: ProtocolCapabilities,
  ): void;
  recordDuplicate(fromNodeId: number): void;
  recordForeignLora(
    nodeId: number,
    packetClass: PacketClass,
    rssi?: number,
    snr?: number,
    senderId?: number,
    getNodes?: () => Map<number, MeshNode>,
  ): void;
  recordPacketPath(packetId: number, fromNodeId: number, path: PacketPath): void;
  runReanalysis(
    getNodes: () => Map<number, MeshNode>,
    myNodeNum: number,
    capabilities?: ProtocolCapabilities,
  ): void;
  setCongestionHalosEnabled(enabled: boolean): void;
  setAnomalyHalosEnabled(enabled: boolean): void;
  setIgnoreMqttEnabled(enabled: boolean): void;
  setNodeMqttIgnored(nodeId: number, ignored: boolean): void;
  setOurPositionSource(source: GpsSource | null): void;
  setEnvMode(mode: EnvMode): void;
  /** Hours (1–168) routing diagnostic rows are kept before pruning; RF rows use fixed 1h. */
  diagnosticRowsMaxAgeHours: number;
  /** Persist max age (hours) for routing diagnostic rows; 1–168; RF stays 1h. */
  setDiagnosticRowsMaxAgeHours(hours: number): void;
  clearDiagnostics(): void;
  /** Clear persisted snapshot only (rows unchanged until next analysis). */
  clearDiagnosticRowsSnapshot(): void;
  /** Load MeshCore hop/trace history from database for a node */
  loadMeshcorePathHistory(nodeId: number): void;
  /** Save MeshCore hop count to database (MeshCore only) */
  saveMeshcoreHopHistory(
    nodeId: number,
    hops: number | null,
    snr: number | null,
    rssi: number | null,
  ): Promise<void>;
  /** Save MeshCore trace result to database (MeshCore only) */
  saveMeshcoreTraceHistory(
    nodeId: number,
    pathLen: number | null,
    pathSnrs: number[],
    lastSnr: number | null,
    tag: number,
  ): Promise<void>;
  /** Prune MeshCore path history when node goes offline */
  pruneMeshcorePathHistory(nodeId: number): Promise<void>;
  getCuStats24h(nodeId: number): ReturnType<typeof computeCuStats24h>;
  /** Move foreign LoRa detection and RF rows from nodeId 0 to real self node (call when self ID first known). */
  migrateForeignLoraFromZero(toNodeId: number): void;
}

// Module-level debounce timer and pending analysis buffer
let analysisTimer: ReturnType<typeof setTimeout> | null = null;
const pendingAnalyses = new Map<number, { node: MeshNode; homeNode: MeshNode | null }>();

function loadPersistedBool(key: string): boolean {
  const raw = getAppSettingsRaw();
  const o = parseStoredJson<Record<string, unknown>>(raw, 'diagnosticsStore loadPersistedBool');
  if (!o) return false;
  return (o[key] ?? false) as boolean;
}

function loadEnvMode(): EnvMode {
  const raw = getAppSettingsRaw();
  const o = parseStoredJson<{ envMode?: string }>(raw, 'diagnosticsStore loadEnvMode');
  const val = o?.envMode;
  if (val === 'city' || val === 'canyon') return val;
  return 'standard';
}

function loadMqttIgnoredNodes(): Set<number> {
  const raw = localStorage.getItem('mesh-client:mqttIgnoredNodes');
  const arr = parseStoredJson<unknown>(raw, 'diagnosticsStore loadMqttIgnoredNodes');
  if (Array.isArray(arr) && arr.every((n) => typeof n === 'number')) {
    return new Set<number>(arr);
  }
  return new Set();
}

function saveMqttIgnoredNodes(nodes: Set<number>): void {
  try {
    console.debug('[diagnosticsStore] saveMqttIgnoredNodes');
    localStorage.setItem('mesh-client:mqttIgnoredNodes', JSON.stringify([...nodes]));
  } catch (e) {
    console.warn('[diagnosticsStore] saveMqttIgnoredNodes failed', e);
  }
}

const initialSnapshot = loadDiagnosticRowsSnapshot();

export const useDiagnosticsStore = create<DiagnosticsState>((set, get) => ({
  diagnosticRows: initialSnapshot?.rows ?? [],
  diagnosticRowsRestoredAt: initialSnapshot ? initialSnapshot.savedAt : null,
  hopHistory: new Map(),
  cuHistory: new Map(),
  packetStats: new Map(),
  packetCache: new Map(),
  nodeRedundancy: new Map(),
  congestionHalosEnabled: loadPersistedBool('congestionHalosEnabled'),
  anomalyHalosEnabled: loadPersistedBool('anomalyHalosEnabled'),
  ignoreMqttEnabled: loadPersistedBool('ignoreMqttEnabled'),
  mqttIgnoredNodes: loadMqttIgnoredNodes(),
  ourPositionSource: null,
  envMode: loadEnvMode(),
  diagnosticRowsMaxAgeHours: loadDiagnosticRowsMaxAgeHours(),
  foreignLoraDetections: new Map(),
  meshcoreHopHistory: new Map(),
  meshcoreTraceHistory: new Map(),

  getForeignLoraDetectionsList(nodeId: number) {
    const bySender = get().foreignLoraDetections.get(nodeId);
    if (!bySender) return [];
    const cutoff = Date.now() - FOREIGN_LORA_WINDOW_MS;
    const list = [...bySender.values()].filter((d) => d.detectedAt >= cutoff);
    list.sort((a, b) => b.detectedAt - a.detectedAt);
    return list;
  },

  loadMeshcorePathHistory(nodeId: number) {
    const dbApi = window.electronAPI?.db;
    if (!dbApi) return;
    try {
      dbApi
        .getMeshcoreHopHistory(nodeId)
        .then((hopRow) => {
          if (hopRow) {
            set((state) => {
              const newMap = new Map(state.meshcoreHopHistory);
              newMap.set(nodeId, {
                timestamp: hopRow.timestamp,
                hops: hopRow.hops,
                snr: hopRow.snr,
                rssi: hopRow.rssi,
              });
              return { meshcoreHopHistory: newMap };
            });
          }
        })
        .catch((e: unknown) => {
          console.warn('[diagnosticsStore] loadMeshcoreHopHistory failed', e);
        });
    } catch (e) {
      console.warn('[diagnosticsStore] loadMeshcoreHopHistory failed', e);
    }
    try {
      dbApi
        .getMeshcoreTraceHistory(nodeId)
        .then((traceRows) => {
          if (traceRows && traceRows.length > 0) {
            const parsed = traceRows.map((traceRow) => ({
              id: traceRow.id,
              timestamp: traceRow.timestamp,
              pathLen: traceRow.path_len,
              pathSnrs: meshcoreTracePathSnrsFromDbJson(traceRow.path_snrs),
              lastSnr: traceRow.last_snr,
              tag: traceRow.tag,
            }));
            set((state) => {
              const newMap = new Map(state.meshcoreTraceHistory);
              newMap.set(nodeId, parsed);
              return { meshcoreTraceHistory: newMap };
            });
          }
        })
        .catch((e: unknown) => {
          console.warn('[diagnosticsStore] loadMeshcoreTraceHistory failed', e);
        });
    } catch (e) {
      console.warn('[diagnosticsStore] loadMeshcoreTraceHistory failed', e);
    }
  },

  async saveMeshcoreHopHistory(
    nodeId: number,
    hops: number | null,
    snr: number | null,
    rssi: number | null,
  ) {
    const dbApi = window.electronAPI?.db as {
      saveMeshcoreHopHistory?: (
        nodeId: number,
        timestamp: number,
        hops: number | null,
        snr: number | null,
        rssi: number | null,
      ) => Promise<boolean>;
    } | null;
    if (!dbApi) return;
    const timestamp = Date.now();
    try {
      await dbApi.saveMeshcoreHopHistory?.(nodeId, timestamp, hops, snr, rssi);
      set((state) => {
        const newMap = new Map(state.meshcoreHopHistory);
        newMap.set(nodeId, { timestamp, hops, snr, rssi });
        return { meshcoreHopHistory: newMap };
      });
    } catch (e) {
      console.warn('[diagnosticsStore] saveMeshcoreHopHistory failed', e);
    }
  },

  async saveMeshcoreTraceHistory(
    nodeId: number,
    pathLen: number | null,
    pathSnrs: number[],
    lastSnr: number | null,
    tag: number,
  ) {
    const dbApi = window.electronAPI?.db as {
      saveMeshcoreTraceHistory?: (
        nodeId: number,
        timestamp: number,
        pathLen: number | null,
        pathSnrs: number[],
        lastSnr: number | null,
        tag: number,
      ) => Promise<boolean>;
    } | null;
    if (!dbApi) return;
    const timestamp = Date.now();
    try {
      await dbApi.saveMeshcoreTraceHistory?.(nodeId, timestamp, pathLen, pathSnrs, lastSnr, tag);
      const newEntry = { id: 0, timestamp, pathLen, pathSnrs, lastSnr, tag };
      set((state) => {
        const newMap = new Map(state.meshcoreTraceHistory);
        const existing = newMap.get(nodeId) ?? [];
        const updated = [newEntry, ...existing].slice(0, 5);
        newMap.set(nodeId, updated);
        return { meshcoreTraceHistory: newMap };
      });
    } catch (e) {
      console.warn('[diagnosticsStore] saveMeshcoreTraceHistory failed', e);
    }
  },

  async pruneMeshcorePathHistory(nodeId: number) {
    const dbApi = window.electronAPI?.db as {
      pruneMeshcorePathHistory?: (nodeId: number) => Promise<boolean>;
    } | null;
    if (!dbApi) return;
    try {
      await dbApi.pruneMeshcorePathHistory?.(nodeId);
      set((state) => {
        const newHopMap = new Map(state.meshcoreHopHistory);
        newHopMap.delete(nodeId);
        const newTraceMap = new Map(state.meshcoreTraceHistory);
        newTraceMap.delete(nodeId);
        return { meshcoreHopHistory: newHopMap, meshcoreTraceHistory: newTraceMap };
      });
    } catch (e) {
      console.warn('[diagnosticsStore] pruneMeshcorePathHistory failed', e);
    }
  },

  processNodeUpdate(
    node: MeshNode,
    homeNode: MeshNode | null,
    myNodeNum?: number,
    capabilities?: ProtocolCapabilities,
  ) {
    const now = Date.now();
    set((state) => {
      // Record hop history (keep last 24h)
      const existing = state.hopHistory.get(node.node_id) ?? [];
      const pruned = existing.filter((p) => p.t > now - TWENTY_FOUR_HOURS);
      if (node.hops_away !== undefined) {
        pruned.push({ t: now, h: node.hops_away });
      }
      const newHopHistory = new Map(state.hopHistory);
      newHopHistory.set(node.node_id, pruned);

      // CU history for spike detection (24h rolling)
      const newCuHistory = new Map(state.cuHistory);
      if (node.channel_utilization != null) {
        const cuExisting = state.cuHistory.get(node.node_id) ?? [];
        const cuPruned = cuExisting.filter((s) => s.t > now - TWENTY_FOUR_HOURS);
        cuPruned.push({ t: now, cu: node.channel_utilization });
        newCuHistory.set(node.node_id, cuPruned);
      }

      // Increment total packet count
      const stats = state.packetStats.get(node.node_id) ?? { total: 0, duplicates: 0 };
      const newPacketStats = new Map(state.packetStats);
      newPacketStats.set(node.node_id, { ...stats, total: stats.total + 1 });

      return { hopHistory: newHopHistory, cuHistory: newCuHistory, packetStats: newPacketStats };
    });

    // Buffer this node for debounced analysis
    pendingAnalyses.set(node.node_id, { node, homeNode });

    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = setTimeout(() => {
      const state = get();
      set((s) => {
        const newAnomalies = new Map<number, NodeAnomaly>();
        for (const [id, a] of diagnosticRowsToRoutingMap(s.diagnosticRows)) {
          newAnomalies.set(id, a);
        }
        const isLowAccuracy = !!(s.ourPositionSource && isLowAccuracyPosition(s.ourPositionSource));
        const { distanceMultiplier, hopsThreshold } = getEnvParams(s.envMode, isLowAccuracy);
        for (const [nodeId, { node: n, homeNode: hn }] of pendingAnalyses) {
          const history = state.hopHistory.get(nodeId) ?? [];
          const stats = state.packetStats.get(nodeId);
          const ignoreMqtt = state.ignoreMqttEnabled || state.mqttIgnoredNodes.has(nodeId);
          const anomaly = analyzeNode(
            n,
            stats,
            hn,
            history,
            ignoreMqtt,
            distanceMultiplier,
            0,
            hopsThreshold,
            capabilities,
          );
          if (anomaly) newAnomalies.set(nodeId, anomaly);
          else newAnomalies.delete(nodeId);
        }
        let diagnosticRows = replaceRoutingRowsFromMap(s.diagnosticRows, newAnomalies);
        if (myNodeNum != null) {
          const homeFromPending = pendingAnalyses.get(myNodeNum)?.node;
          if (
            homeFromPending &&
            (hasLocalStatsData(homeFromPending) || homeFromPending.channel_utilization != null)
          ) {
            const cuStats24h = get().getCuStats24h(myNodeNum);
            const findings = diagnoseConnectedNode(homeFromPending, {
              cuStats24h: cuStats24h ?? undefined,
              capabilities,
            });
            if (findings.length > 0) {
              diagnosticRows = replaceRfRowsForNode(diagnosticRows, myNodeNum, findings);
            } else {
              diagnosticRows = diagnosticRows.filter(
                (r) => r.kind !== 'rf' || r.nodeId !== myNodeNum,
              );
            }
          }
        }
        const now = Date.now();
        diagnosticRows = pruneDiagnosticRowsByAge(
          diagnosticRows,
          now,
          loadRoutingDiagnosticMaxAgeMs(),
          DEFAULT_RF_DIAGNOSTIC_MAX_AGE_MS,
        );
        pendingAnalyses.clear();
        schedulePersistDiagnosticRows(() => get().diagnosticRows);
        return { diagnosticRows, diagnosticRowsRestoredAt: null };
      });
    }, 2000);
  },

  recordDuplicate(fromNodeId: number) {
    set((state) => {
      const stats = state.packetStats.get(fromNodeId) ?? { total: 0, duplicates: 0 };
      const newPacketStats = new Map(state.packetStats);
      newPacketStats.set(fromNodeId, { ...stats, duplicates: stats.duplicates + 1 });
      return { packetStats: newPacketStats };
    });
  },

  recordForeignLora(
    nodeId: number,
    packetClass: PacketClass,
    rssi?: number,
    snr?: number,
    senderId?: number,
    getNodes?: () => Map<number, MeshNode>,
  ) {
    const now = Date.now();
    const proximity = classifyProximity(rssi, snr);
    const senderKey = foreignLoraSenderKey(packetClass, senderId);
    const longName =
      senderId != null
        ? (getNodes?.()?.get(senderId)?.long_name ?? getNodes?.()?.get(senderId)?.short_name)
        : undefined;

    set((state) => {
      const bySender = new Map(state.foreignLoraDetections.get(nodeId) ?? []);
      const existing = bySender.get(senderKey);
      const updated: ForeignLoraDetection = {
        detectedAt: now,
        rssi,
        snr,
        proximity,
        packetClass,
        count: (existing?.count ?? 0) + 1,
        lastSenderId: senderId ?? existing?.lastSenderId,
        longName: longName ?? existing?.longName,
      };
      bySender.set(senderKey, updated);
      // Prune entries older than 90 minutes
      const cutoff = now - FOREIGN_LORA_WINDOW_MS;
      for (const [k, d] of bySender.entries()) {
        if (d.detectedAt < cutoff) bySender.delete(k);
      }
      const next = new Map(state.foreignLoraDetections);
      next.set(nodeId, bySender);
      return { foreignLoraDetections: next };
    });

    // Rate counter for MeshCore-class packets
    if (packetClass === 'meshcore') {
      meshcoreRateCounter.record();
    }

    // RF row cooldown: only update diagnostic rows every 5 minutes per nodeId+class
    const cooldownKey = `${nodeId}:${packetClass}`;
    const lastUpdate = rfRowCooldowns.get(cooldownKey) ?? 0;
    if (now - lastUpdate < 5 * 60 * 1000) return;
    rfRowCooldowns.set(cooldownKey, now);

    // Build cause text
    const nodes = getNodes?.();
    let condition: string;
    let cause: string;

    if (packetClass === 'meshcore') {
      condition = 'MeshCore Activity Detected';
      if (proximity === 'very-close') {
        cause = `MeshCore node very close (RSSI ${rssi} dBm) — likely causing packet collisions.`;
      } else if (proximity === 'nearby') {
        cause = `MeshCore node detected nearby (RSSI ${rssi} dBm) — may interfere with traffic.`;
      } else if (proximity === 'distant') {
        cause = `Distant MeshCore activity on this frequency (RSSI ${rssi} dBm).`;
      } else {
        cause = 'MeshCore node transmitting on this frequency.';
      }
    } else if (packetClass === 'meshtastic') {
      condition = 'Meshtastic Traffic Detected';
      const senderHex = senderId ? `!${senderId.toString(16).padStart(8, '0')}` : 'unknown';
      const senderNode = senderId ? nodes?.get(senderId) : undefined;
      const senderName = senderNode?.long_name || senderNode?.short_name;
      const senderLabel = senderName ? `${senderHex} (${senderName})` : senderHex;
      const proxLabel =
        proximity === 'very-close'
          ? 'Very close'
          : proximity === 'nearby'
            ? 'Nearby'
            : proximity === 'distant'
              ? 'Distant'
              : '';
      cause = `Meshtastic node transmitting on this frequency. Sender: ${senderLabel}. ${proxLabel ? proxLabel + '. ' : ''}This node may be in your MeshCore repeater area.`;
    } else {
      condition = 'Unknown LoRa Traffic';
      cause = `Unrecognized LoRa signal detected (RSSI ${rssi ?? '?'} dBm, SNR ${snr ?? '?'} dB).`;
    }

    const mainRow: RfDiagnosticRow = {
      kind: 'rf',
      id: rfRowId(nodeId, condition),
      nodeId,
      condition,
      cause,
      severity: 'info',
      detectedAt: now,
    };

    const extraRows: RfDiagnosticRow[] = [];
    if (packetClass === 'meshcore' && meshcoreRateCounter.getRate() > 5) {
      extraRows.push({
        kind: 'rf',
        id: rfRowId(nodeId, 'Potential MeshCore Repeater Conflict'),
        nodeId,
        condition: 'Potential MeshCore Repeater Conflict',
        cause:
          'High MeshCore packet rate detected (>5/min). A nearby MeshCore repeater may be causing packet collisions.',
        severity: 'warning',
        detectedAt: now,
      });
    }

    set((state) => {
      // Replace only foreign LoRa rows (preserve CU spike and other RF rows)
      const withoutForeign = state.diagnosticRows.filter(
        (r) =>
          !(r.kind === 'rf' && r.nodeId === nodeId && FOREIGN_LORA_CONDITIONS.has(r.condition)),
      );
      const diagnosticRows = [...withoutForeign, mainRow, ...extraRows];
      schedulePersistDiagnosticRows(() => get().diagnosticRows);
      return { diagnosticRows };
    });
  },

  recordPacketPath(packetId: number, fromNodeId: number, path: PacketPath) {
    set((state) => {
      // Reject invalid cache keys: must be a non-zero finite integer (id 0 = no unique id per protobuf)
      if (!Number.isInteger(packetId) || packetId === 0) return state;
      const now = Date.now();
      const existing = state.packetCache.get(packetId);

      const newPacketCache = new Map(state.packetCache);
      let record: PacketRecord;

      if (!existing || now - existing.firstSeen > FIFTEEN_MIN) {
        record = { packetId, fromNodeId, firstSeen: now, lastSeen: now, paths: [path] };
      } else {
        record = { ...existing, lastSeen: now, paths: [...existing.paths, path] };
      }
      newPacketCache.set(packetId, record);

      // Periodic TTL cleanup when cache gets large
      if (newPacketCache.size > 2000) {
        for (const [id, rec] of newPacketCache) {
          if (now - rec.firstSeen > FIFTEEN_MIN) newPacketCache.delete(id);
        }
      }

      // Recompute redundancy for this node from last 20 packets
      const nodePackets: PacketRecord[] = [];
      for (const rec of newPacketCache.values()) {
        if (rec.fromNodeId === fromNodeId) nodePackets.push(rec);
      }
      nodePackets.sort((a, b) => b.lastSeen - a.lastSeen);
      const recentPackets = nodePackets.slice(0, 20);
      const maxPaths = recentPackets.reduce((m, r) => Math.max(m, r.paths.length), 0);
      const score = Math.max(0, Math.min(Math.round(((maxPaths - 1) / 3) * 100), 100));

      const newNodeRedundancy = new Map(state.nodeRedundancy);
      newNodeRedundancy.set(fromNodeId, { maxPaths, score, recentPackets });

      return { packetCache: newPacketCache, nodeRedundancy: newNodeRedundancy };
    });
  },

  runReanalysis(
    getNodes: () => Map<number, MeshNode>,
    myNodeNum: number,
    capabilities?: ProtocolCapabilities,
  ) {
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = setTimeout(() => {
      const state = get();
      const nodes = getNodes();
      const homeNode = nodes.get(myNodeNum) ?? null;
      const isLowAccuracy = !!(
        state.ourPositionSource && isLowAccuracyPosition(state.ourPositionSource)
      );
      const { distanceMultiplier, hopsThreshold } = getEnvParams(state.envMode, isLowAccuracy);
      const newAnomalies = new Map<number, NodeAnomaly>();
      for (const [nodeId, node] of nodes) {
        if (nodeId === myNodeNum) continue;
        const history = state.hopHistory.get(nodeId) ?? [];
        const stats = state.packetStats.get(nodeId);
        const ignoreMqtt = state.ignoreMqttEnabled || state.mqttIgnoredNodes.has(nodeId);
        const anomaly = analyzeNode(
          node,
          stats,
          homeNode,
          history,
          ignoreMqtt,
          distanceMultiplier,
          0,
          hopsThreshold,
          capabilities,
        );
        if (anomaly) newAnomalies.set(nodeId, anomaly);
      }
      let diagnosticRows = replaceRoutingRowsFromMap(state.diagnosticRows, newAnomalies);
      const selfNode = nodes.get(myNodeNum);
      if (selfNode && (hasLocalStatsData(selfNode) || selfNode.channel_utilization != null)) {
        const cuStats24h = get().getCuStats24h(myNodeNum);
        const findings = diagnoseConnectedNode(selfNode, {
          cuStats24h: cuStats24h ?? undefined,
          capabilities,
        });
        if (findings.length > 0) {
          diagnosticRows = replaceRfRowsForNode(diagnosticRows, myNodeNum, findings);
        } else {
          diagnosticRows = diagnosticRows.filter((r) => r.kind !== 'rf' || r.nodeId !== myNodeNum);
        }
      }
      for (const [nodeId, node] of nodes) {
        if (nodeId === myNodeNum) continue;
        const cuStats24h = get().getCuStats24h(nodeId);
        const findings = diagnoseOtherNode(node, {
          cuStats24h: cuStats24h ?? undefined,
          capabilities,
        });
        if (findings && findings.length > 0) {
          diagnosticRows = replaceRfRowsForNode(diagnosticRows, nodeId, findings);
        } else {
          diagnosticRows = diagnosticRows.filter((r) => r.kind !== 'rf' || r.nodeId !== nodeId);
        }
      }
      const now = Date.now();
      diagnosticRows = pruneDiagnosticRowsByAge(
        diagnosticRows,
        now,
        loadRoutingDiagnosticMaxAgeMs(),
        DEFAULT_RF_DIAGNOSTIC_MAX_AGE_MS,
      );
      set({ diagnosticRows, diagnosticRowsRestoredAt: null });
      schedulePersistDiagnosticRows(() => get().diagnosticRows);
    }, 2000);
  },

  setCongestionHalosEnabled(enabled: boolean) {
    mergeAppSetting(
      'congestionHalosEnabled',
      enabled,
      'diagnosticsStore setCongestionHalosEnabled',
    );
    set({ congestionHalosEnabled: enabled });
  },

  setAnomalyHalosEnabled(enabled: boolean) {
    mergeAppSetting('anomalyHalosEnabled', enabled, 'diagnosticsStore setAnomalyHalosEnabled');
    set({ anomalyHalosEnabled: enabled });
  },

  setIgnoreMqttEnabled(enabled: boolean) {
    mergeAppSetting('ignoreMqttEnabled', enabled, 'diagnosticsStore setIgnoreMqttEnabled');
    set({ ignoreMqttEnabled: enabled });
  },

  setNodeMqttIgnored(nodeId: number, ignored: boolean) {
    set((state) => {
      const next = new Set(state.mqttIgnoredNodes);
      if (ignored) next.add(nodeId);
      else next.delete(nodeId);
      saveMqttIgnoredNodes(next);
      return { mqttIgnoredNodes: next };
    });
  },

  setOurPositionSource(source: GpsSource | null) {
    set({ ourPositionSource: source });
  },

  setEnvMode(mode: EnvMode) {
    mergeAppSetting('envMode', mode, 'diagnosticsStore setEnvMode');
    set({ envMode: mode });
  },

  setDiagnosticRowsMaxAgeHours(hours: number) {
    const h = Math.round(hours);
    if (!Number.isFinite(h) || h < 1 || h > 168) return;
    mergeAppSetting(
      'diagnosticRowsMaxAgeHours',
      h,
      'diagnosticsStore setDiagnosticRowsMaxAgeHours',
    );
    const now = Date.now();
    set((s) => ({
      diagnosticRowsMaxAgeHours: h,
      diagnosticRows: pruneDiagnosticRowsByAge(
        s.diagnosticRows,
        now,
        h * 60 * 60 * 1000,
        DEFAULT_RF_DIAGNOSTIC_MAX_AGE_MS,
      ),
    }));
    schedulePersistDiagnosticRows(() => get().diagnosticRows);
  },

  getCuStats24h(nodeId: number) {
    const samples = get().cuHistory.get(nodeId) ?? [];
    return computeCuStats24h(samples);
  },

  clearDiagnosticRowsSnapshot() {
    clearPersistedDiagnosticRowsSnapshot();
    set({ diagnosticRowsRestoredAt: null });
  },

  clearDiagnostics() {
    console.debug('[diagnosticsStore] clearDiagnostics');
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = null;
    pendingAnalyses.clear();
    resetCuSpikeCooldown();
    clearPersistedDiagnosticRowsSnapshot();
    rfRowCooldowns.clear();
    set({
      diagnosticRows: [],
      diagnosticRowsRestoredAt: null,
      hopHistory: new Map(),
      cuHistory: new Map(),
      packetStats: new Map(),
      packetCache: new Map(),
      nodeRedundancy: new Map(),
      foreignLoraDetections: new Map(),
      meshcoreHopHistory: new Map(),
      meshcoreTraceHistory: new Map(),
    });
  },

  migrateForeignLoraFromZero(toNodeId: number) {
    if (toNodeId === 0) return;
    set((state) => {
      const bySenderAtZero = state.foreignLoraDetections.get(0);
      if (!bySenderAtZero) return state;
      const nextDetections = new Map(state.foreignLoraDetections);
      nextDetections.delete(0);
      nextDetections.set(toNodeId, new Map(bySenderAtZero));
      const diagnosticRows = state.diagnosticRows.map((r) => {
        if (r.kind === 'rf' && r.nodeId === 0 && FOREIGN_LORA_CONDITIONS.has(r.condition)) {
          return { ...r, nodeId: toNodeId, id: rfRowId(toNodeId, r.condition) };
        }
        return r;
      });
      schedulePersistDiagnosticRows(() => get().diagnosticRows);
      return { foreignLoraDetections: nextDetections, diagnosticRows };
    });
  },
}));
