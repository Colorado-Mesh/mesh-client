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
import { useDeviceStore } from './deviceStore';
import { useDiagnosticsStore } from './diagnosticsStore';
import { useIdentityStore } from './identityStore';
import { useMapLayerStore } from './mapLayerStore';
import { useMapViewportStore } from './mapViewportStore';
import { useMessageStore } from './messageStore';
import { useNodeStore } from './nodeStore';
import { usePositionHistoryStore } from './positionHistoryStore';
import { useRepeaterSignalStore } from './repeaterSignalStore';

const initialDiagnosticsState = useDiagnosticsStore.getInitialState();
const initialMapViewportState = useMapViewportStore.getInitialState();
const initialPositionHistoryState = usePositionHistoryStore.getInitialState();
const initialRepeaterSignalState = useRepeaterSignalStore.getInitialState();
const initialMapLayerState = useMapLayerStore.getInitialState();

function stateKeys(stateObject: object) {
  const state = stateObject as Record<string, unknown>;
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
    useDiagnosticsStore.setState(initialDiagnosticsState, true);
    useMapViewportStore.setState(initialMapViewportState, true);
    useMapLayerStore.setState({ ...initialMapLayerState, layersPanelOpen: false });
    usePositionHistoryStore.setState(initialPositionHistoryState, true);
    useRepeaterSignalStore.setState(initialRepeaterSignalState, true);
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
          "pathUpdatedTimestamps",
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
          "getMeshcoreHeardByMeshtasticList",
          "loadMeshcorePathHistory",
          "migrateForeignLoraFromZero",
          "processNodeUpdate",
          "pruneMeshcorePathHistory",
          "recordDuplicate",
          "recordForeignLora",
          "recordNoisePort",
          "recordPacketPath",
          "recordPathUpdated",
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
          "pendingFocus",
          "viewport",
        ]
      `);
    });

    it('action method names are stable', () => {
      const { fns } = stateKeys(useMapViewportStore.getState());
      expect(fns).toMatchInlineSnapshot(`
        [
          "clearPendingFocus",
          "requestFocus",
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
  });

  describe('useDeviceStore', () => {
    it('data property names are stable', () => {
      const { data } = stateKeys(useDeviceStore.getState());
      expect(data).toMatchInlineSnapshot(`
        [
          "devices",
        ]
      `);
    });
  });

  describe('useMapLayerStore', () => {
    it('data property names are stable', () => {
      const { data } = stateKeys(useMapLayerStore.getState());
      expect(data).toMatchInlineSnapshot(`
        [
          "basemapId",
          "layersPanelOpen",
          "showNodes",
          "showWaypoints",
        ]
      `);
    });

    it('action method names are stable', () => {
      const { fns } = stateKeys(useMapLayerStore.getState());
      expect(fns).toMatchInlineSnapshot(`
        [
          "hydrateFromDatabase",
          "setBasemapId",
          "setLayersPanelOpen",
          "setShowNodes",
          "setShowWaypoints",
        ]
      `);
    });
  });
});
