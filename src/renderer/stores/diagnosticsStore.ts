import { create } from 'zustand';

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
import type { GpsSource } from '../lib/gpsSource';
import { isLowAccuracyPosition } from '../lib/gpsSource';
import { parseStoredJson } from '../lib/parseStoredJson';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type { DiagnosticRow, HopHistoryPoint, MeshNode, NodeAnomaly } from '../lib/types';

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

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

/** Routing diagnostic max age from adminSettings (hours); default 24. */
function loadRoutingDiagnosticMaxAgeMs(): number {
  const raw = localStorage.getItem('mesh-client:adminSettings');
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
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.rows)) return null;
  let rows = parsed.rows.filter(isValidDiagnosticRow);
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
  processNodeUpdate(
    node: MeshNode,
    homeNode: MeshNode | null,
    myNodeNum?: number,
    capabilities?: ProtocolCapabilities,
  ): void;
  recordDuplicate(fromNodeId: number): void;
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
  getCuStats24h(nodeId: number): ReturnType<typeof computeCuStats24h>;
}

// Module-level debounce timer and pending analysis buffer
let analysisTimer: ReturnType<typeof setTimeout> | null = null;
const pendingAnalyses = new Map<number, { node: MeshNode; homeNode: MeshNode | null }>();

function loadAdminBool(key: string): boolean {
  const raw = localStorage.getItem('mesh-client:adminSettings');
  const o = parseStoredJson<Record<string, unknown>>(raw, 'diagnosticsStore loadAdminBool');
  if (!o) return false;
  return (o[key] ?? false) as boolean;
}

function loadEnvMode(): EnvMode {
  const raw = localStorage.getItem('mesh-client:adminSettings');
  const o = parseStoredJson<{ envMode?: string }>(raw, 'diagnosticsStore loadEnvMode');
  const val = o?.envMode;
  if (val === 'city' || val === 'canyon') return val;
  return 'standard';
}

function saveAdminKey(key: string, value: unknown): void {
  try {
    const raw = localStorage.getItem('mesh-client:adminSettings');
    const s =
      parseStoredJson<Record<string, unknown>>(raw, 'diagnosticsStore saveAdminKey read') ?? {};
    localStorage.setItem('mesh-client:adminSettings', JSON.stringify({ ...s, [key]: value }));
  } catch (e) {
    console.warn('[diagnosticsStore] saveAdminKey failed', key, e);
  }
}

function loadMqttIgnoredNodes(): Set<number> {
  const raw = localStorage.getItem('mesh-client:mqttIgnoredNodes');
  const arr = parseStoredJson<unknown>(raw, 'diagnosticsStore loadMqttIgnoredNodes');
  if (Array.isArray(arr) && arr.every((n) => typeof n === 'number')) {
    return new Set<number>(arr as number[]);
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
  congestionHalosEnabled: loadAdminBool('congestionHalosEnabled'),
  anomalyHalosEnabled: loadAdminBool('anomalyHalosEnabled'),
  ignoreMqttEnabled: loadAdminBool('ignoreMqttEnabled'),
  mqttIgnoredNodes: loadMqttIgnoredNodes(),
  ourPositionSource: null,
  envMode: loadEnvMode(),
  diagnosticRowsMaxAgeHours: loadDiagnosticRowsMaxAgeHours(),

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
    saveAdminKey('congestionHalosEnabled', enabled);
    set({ congestionHalosEnabled: enabled });
  },

  setAnomalyHalosEnabled(enabled: boolean) {
    saveAdminKey('anomalyHalosEnabled', enabled);
    set({ anomalyHalosEnabled: enabled });
  },

  setIgnoreMqttEnabled(enabled: boolean) {
    saveAdminKey('ignoreMqttEnabled', enabled);
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
    saveAdminKey('envMode', mode);
    set({ envMode: mode });
  },

  setDiagnosticRowsMaxAgeHours(hours: number) {
    const h = Math.round(hours);
    if (!Number.isFinite(h) || h < 1 || h > 168) return;
    saveAdminKey('diagnosticRowsMaxAgeHours', h);
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
    try {
      localStorage.removeItem(DIAGNOSTIC_ROWS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    set({ diagnosticRowsRestoredAt: null });
  },

  clearDiagnostics() {
    console.debug('[diagnosticsStore] clearDiagnostics');
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = null;
    pendingAnalyses.clear();
    resetCuSpikeCooldown();
    try {
      localStorage.removeItem(DIAGNOSTIC_ROWS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    set({
      diagnosticRows: [],
      diagnosticRowsRestoredAt: null,
      hopHistory: new Map(),
      cuHistory: new Map(),
      packetStats: new Map(),
      packetCache: new Map(),
      nodeRedundancy: new Map(),
    });
  },
}));
