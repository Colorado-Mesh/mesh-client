import { create } from "zustand";
import type { MeshNode, NodeAnomaly, HopHistoryPoint } from "../lib/types";
import { analyzeNode } from "../lib/diagnostics/RoutingDiagnosticEngine";

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

interface DiagnosticsState {
  anomalies: Map<number, NodeAnomaly>;
  hopHistory: Map<number, HopHistoryPoint[]>;
  packetStats: Map<number, { total: number; duplicates: number }>;
  congestionHalosEnabled: boolean;
  anomalyHalosEnabled: boolean;
  ignoreMqttEnabled: boolean;
  processNodeUpdate(node: MeshNode, homeNode: MeshNode | null): void;
  recordDuplicate(fromNodeId: number): void;
  runReanalysis(nodes: Map<number, MeshNode>, myNodeNum: number): void;
  setCongestionHalosEnabled(enabled: boolean): void;
  setAnomalyHalosEnabled(enabled: boolean): void;
  setIgnoreMqttEnabled(enabled: boolean): void;
}

// Module-level debounce timer and pending analysis buffer
let analysisTimer: ReturnType<typeof setTimeout> | null = null;
const pendingAnalyses = new Map<
  number,
  { node: MeshNode; homeNode: MeshNode | null }
>();

function loadAdminBool(key: string): boolean {
  try {
    const raw = localStorage.getItem("mesh-client:adminSettings");
    return raw ? (JSON.parse(raw)[key] ?? false) : false;
  } catch {
    return false;
  }
}

function saveAdminKey(key: string, value: boolean): void {
  try {
    const raw = localStorage.getItem("mesh-client:adminSettings");
    const s = raw ? JSON.parse(raw) : {};
    localStorage.setItem("mesh-client:adminSettings", JSON.stringify({ ...s, [key]: value }));
  } catch {}
}

export const useDiagnosticsStore = create<DiagnosticsState>((set, get) => ({
  anomalies: new Map(),
  hopHistory: new Map(),
  packetStats: new Map(),
  congestionHalosEnabled: loadAdminBool("congestionHalosEnabled"),
  anomalyHalosEnabled: loadAdminBool("anomalyHalosEnabled"),
  ignoreMqttEnabled: loadAdminBool("ignoreMqttEnabled"),

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
        for (const [nodeId, { node: n, homeNode: hn }] of pendingAnalyses) {
          const history = state.hopHistory.get(nodeId) ?? [];
          const stats = state.packetStats.get(nodeId);
          const anomaly = analyzeNode(n, stats, hn, history, state.ignoreMqttEnabled);
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

  runReanalysis(nodes: Map<number, MeshNode>, myNodeNum: number) {
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = setTimeout(() => {
      const state = get();
      const homeNode = nodes.get(myNodeNum) ?? null;
      const newAnomalies = new Map<number, NodeAnomaly>();
      for (const [nodeId, node] of nodes) {
        if (nodeId === myNodeNum) continue;
        const history = state.hopHistory.get(nodeId) ?? [];
        const stats = state.packetStats.get(nodeId);
        const anomaly = analyzeNode(node, stats, homeNode, history, state.ignoreMqttEnabled);
        if (anomaly) newAnomalies.set(nodeId, anomaly);
      }
      set({ anomalies: newAnomalies });
    }, 2000);
  },

  setCongestionHalosEnabled(enabled: boolean) {
    saveAdminKey("congestionHalosEnabled", enabled);
    set({ congestionHalosEnabled: enabled });
  },

  setAnomalyHalosEnabled(enabled: boolean) {
    saveAdminKey("anomalyHalosEnabled", enabled);
    set({ anomalyHalosEnabled: enabled });
  },

  setIgnoreMqttEnabled(enabled: boolean) {
    saveAdminKey("ignoreMqttEnabled", enabled);
    set({ ignoreMqttEnabled: enabled });
  },
}));
