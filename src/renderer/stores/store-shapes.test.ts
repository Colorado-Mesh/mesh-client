/**
 * Store shape contract tests.
 *
 * These tests snapshot the property names of each Zustand store's initial state.
 * Their purpose is to catch AI-induced regressions where a refactor silently
 * drops, renames, or adds state properties without updating consumers.
 *
 * When a property is intentionally added or removed, update the snapshot:
 *   pnpm run test:run -- --update-snapshots
 */
import { afterEach, describe, expect, it } from 'vitest';

import { useConnectionStore } from './connectionStore';
import { useDiagnosticsStore } from './diagnosticsStore';
import { useIdentityStore } from './identityStore';
import { useMapViewportStore } from './mapViewportStore';
import { useMessageStore } from './messageStore';
import { useNodeStore } from './nodeStore';
import { usePositionHistoryStore } from './positionHistoryStore';
import { useRepeaterSignalStore } from './repeaterSignalStore';

function stateKeys(store: object) {
  const state = store as Record<string, unknown>;
  const data = Object.keys(state)
    .filter((k) => typeof state[k] !== 'function')
    .sort();
  const fns = Object.keys(state)
    .filter((k) => typeof state[k] === 'function')
    .sort();
  return { data, fns };
}

describe('store shape contracts', () => {
  afterEach(() => {
    // Reset stores to clean initial state between tests
    useDiagnosticsStore.getState().clearDiagnostics();
    usePositionHistoryStore.setState({ history: new Map() });
    useRepeaterSignalStore.setState({ history: new Map() });
    useMapViewportStore.setState({ viewport: null });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {} });
    useMessageStore.setState({ messages: {} });
    useConnectionStore.setState({ connections: {} });
  });

  describe('useDiagnosticsStore', () => {
    it('data property names are stable', () => {
      const { data } = stateKeys(useDiagnosticsStore.getState());
      expect(data).toMatchInlineSnapshot(`
        [
          "anomalyHalosEnabled",
          "autoTracerouteEnabledMeshcore",
          "autoTracerouteEnabledMeshtastic",
          "congestionHalosEnabled",
          "cuHistory",
          "diagnosticRows",
          "diagnosticRowsMaxAgeHours",
          "diagnosticRowsRestoredAt",
          "envMode",
          "foreignLoraDetections",
          "hopHistory",
          "ignoreMqttEnabled",
          "localStatsBaselines",
          "meshcoreHopHistory",
          "meshcoreTraceHistory",
          "mqttIgnoredNodes",
          "nodeRedundancy",
          "noiseRateStats",
          "ourPositionSource",
          "packetCache",
          "packetStats",
        ]
      `);
    });

    it('action method names are stable', () => {
      const { fns } = stateKeys(useDiagnosticsStore.getState());
      expect(fns).toMatchInlineSnapshot(`
        [
          "clearDiagnosticRowsSnapshot",
          "clearDiagnostics",
          "getCuStats24h",
          "getForeignLoraDetectionsList",
          "loadMeshcorePathHistory",
          "migrateForeignLoraFromZero",
          "processNodeUpdate",
          "pruneMeshcorePathHistory",
          "recordDuplicate",
          "recordForeignLora",
          "recordNoisePort",
          "recordPacketPath",
          "runReanalysis",
          "saveMeshcoreHopHistory",
          "saveMeshcoreTraceHistory",
          "setAnomalyHalosEnabled",
          "setAutoTracerouteEnabled",
          "setCongestionHalosEnabled",
          "setDiagnosticRowsMaxAgeHours",
          "setEnvMode",
          "setIgnoreMqttEnabled",
          "setNodeMqttIgnored",
          "setOurPositionSource",
        ]
      `);
    });
  });

  describe('usePositionHistoryStore', () => {
    it('data property names are stable', () => {
      const { data } = stateKeys(usePositionHistoryStore.getState());
      expect(data).toMatchInlineSnapshot(`
        [
          "history",
          "historyWindowHours",
          "showPaths",
        ]
      `);
    });

    it('action method names are stable', () => {
      const { fns } = stateKeys(usePositionHistoryStore.getState());
      expect(fns).toMatchInlineSnapshot(`
        [
          "clearHistory",
          "loadHistoryFromDb",
          "recordPosition",
          "setHistoryWindow",
          "setShowPaths",
        ]
      `);
    });
  });

  describe('useRepeaterSignalStore', () => {
    it('data property names are stable', () => {
      const { data } = stateKeys(useRepeaterSignalStore.getState());
      expect(data).toMatchInlineSnapshot(`
        [
          "history",
        ]
      `);
    });

    it('action method names are stable', () => {
      const { fns } = stateKeys(useRepeaterSignalStore.getState());
      expect(fns).toMatchInlineSnapshot(`
        [
          "getHistory",
          "recordSignal",
        ]
      `);
    });
  });

  describe('useMapViewportStore', () => {
    it('data property names are stable', () => {
      const { data } = stateKeys(useMapViewportStore.getState());
      expect(data).toMatchInlineSnapshot(`
        [
          "viewport",
        ]
      `);
    });

    it('action method names are stable', () => {
      const { fns } = stateKeys(useMapViewportStore.getState());
      expect(fns).toMatchInlineSnapshot(`
        [
          "setViewport",
        ]
      `);
    });
  });

  describe('useIdentityStore', () => {
    it('data property names are stable', () => {
      const { data } = stateKeys(useIdentityStore.getState());
      expect(data).toMatchInlineSnapshot(`
        [
          "activeIdentityId",
          "identities",
        ]
      `);
    });

    it('action method names are stable', () => {
      const { fns } = stateKeys(useIdentityStore.getState());
      expect(fns).toMatchInlineSnapshot(`[]`);
    });
  });

  describe('useNodeStore', () => {
    it('data property names are stable', () => {
      const { data } = stateKeys(useNodeStore.getState());
      expect(data).toMatchInlineSnapshot(`
        [
          "neighborInfo",
          "nodes",
          "traceRoutes",
          "waypoints",
        ]
      `);
    });

    it('action method names are stable', () => {
      const { fns } = stateKeys(useNodeStore.getState());
      expect(fns).toMatchInlineSnapshot(`[]`);
    });
  });

  describe('useMessageStore', () => {
    it('data property names are stable', () => {
      const { data } = stateKeys(useMessageStore.getState());
      expect(data).toMatchInlineSnapshot(`
        [
          "messages",
        ]
      `);
    });

    it('action method names are stable', () => {
      const { fns } = stateKeys(useMessageStore.getState());
      expect(fns).toMatchInlineSnapshot(`[]`);
    });
  });

  describe('useConnectionStore', () => {
    it('data property names are stable', () => {
      const { data } = stateKeys(useConnectionStore.getState());
      expect(data).toMatchInlineSnapshot(`
        [
          "connections",
        ]
      `);
    });

    it('action method names are stable', () => {
      const { fns } = stateKeys(useConnectionStore.getState());
      expect(fns).toMatchInlineSnapshot(`[]`);
    });
  });
});
