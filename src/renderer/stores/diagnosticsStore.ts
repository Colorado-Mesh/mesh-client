import { create } from 'zustand';

import { analyzeNode } from '../lib/diagnostics/RoutingDiagnosticEngine';
import type { GpsSource } from '../lib/gpsSource';
import { isLowAccuracyPosition } from '../lib/gpsSource';
import { parseStoredJson } from '../lib/parseStoredJson';
import type { HopHistoryPoint, MeshNode, NodeAnomaly } from '../lib/types';

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

interface DiagnosticsState {
  anomalies: Map<number, NodeAnomaly>;
  hopHistory: Map<number, HopHistoryPoint[]>;
  packetStats: Map<number, { total: number; duplicates: number }>;
  packetCache: Map<number, PacketRecord>;
  nodeRedundancy: Map<number, NodeRedundancy>;
  congestionHalosEnabled: boolean;
  anomalyHalosEnabled: boolean;
  ignoreMqttEnabled: boolean;
  mqttIgnoredNodes: Set<number>;
  ourPositionSource: GpsSource | null;
  envMode: EnvMode;
  processNodeUpdate(node: MeshNode, homeNode: MeshNode | null): void;
  recordDuplicate(fromNodeId: number): void;
  recordPacketPath(packetId: number, fromNodeId: number, path: PacketPath): void;
  runReanalysis(getNodes: () => Map<number, MeshNode>, myNodeNum: number): void;
  setCongestionHalosEnabled(enabled: boolean): void;
  setAnomalyHalosEnabled(enabled: boolean): void;
  setIgnoreMqttEnabled(enabled: boolean): void;
  setNodeMqttIgnored(nodeId: number, ignored: boolean): void;
  setOurPositionSource(source: GpsSource | null): void;
  setEnvMode(mode: EnvMode): void;
  clearDiagnostics(): void;
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

export const useDiagnosticsStore = create<DiagnosticsState>((set, get) => ({
  anomalies: new Map(),
  hopHistory: new Map(),
  packetStats: new Map(),
  packetCache: new Map(),
  nodeRedundancy: new Map(),
  congestionHalosEnabled: loadAdminBool('congestionHalosEnabled'),
  anomalyHalosEnabled: loadAdminBool('anomalyHalosEnabled'),
  ignoreMqttEnabled: loadAdminBool('ignoreMqttEnabled'),
  mqttIgnoredNodes: loadMqttIgnoredNodes(),
  ourPositionSource: null,
  envMode: loadEnvMode(),

  processNodeUpdate(node: MeshNode, homeNode: MeshNode | null) {
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

      // Increment total packet count
      const stats = state.packetStats.get(node.node_id) ?? { total: 0, duplicates: 0 };
      const newPacketStats = new Map(state.packetStats);
      newPacketStats.set(node.node_id, { ...stats, total: stats.total + 1 });

      return { hopHistory: newHopHistory, packetStats: newPacketStats };
    });

    // Buffer this node for debounced analysis
    pendingAnalyses.set(node.node_id, { node, homeNode });

    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = setTimeout(() => {
      const state = get();
      set((s) => {
        const newAnomalies = new Map(s.anomalies);
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
          );
          if (anomaly) newAnomalies.set(nodeId, anomaly);
          else newAnomalies.delete(nodeId);
        }
        pendingAnalyses.clear();
        return { anomalies: newAnomalies };
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

  runReanalysis(getNodes: () => Map<number, MeshNode>, myNodeNum: number) {
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
        );
        if (anomaly) newAnomalies.set(nodeId, anomaly);
      }
      set({ anomalies: newAnomalies });
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

  clearDiagnostics() {
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = null;
    pendingAnalyses.clear();
    set({
      anomalies: new Map(),
      hopHistory: new Map(),
      packetStats: new Map(),
      packetCache: new Map(),
      nodeRedundancy: new Map(),
    });
  },
}));
