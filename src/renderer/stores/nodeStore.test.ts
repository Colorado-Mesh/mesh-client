import { afterEach, describe, expect, it } from 'vitest';

import {
  addTraceRoute,
  appendMeshcoreCliEntry,
  clearMeshcoreCliHistory,
  clearNodeIdentity,
  patchNodeFavorited,
  removeNode,
  updateMeshcoreOp,
  updatePosition,
  updateTelemetry,
  upsertNeighborInfo,
  upsertNode,
  upsertNodeRecord,
  upsertNodeRecordsForIdentity,
  upsertWaypoint,
  useNodeStore,
} from './nodeStore';

const ID = 'identity-1';
const NODE = 42;

describe('nodeStore MeshCore op setters', () => {
  afterEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('updateMeshcoreOp creates node record when none exists', () => {
    updateMeshcoreOp(ID, NODE, { meshcoreStatusError: 'no route' });
    const rec = useNodeStore.getState().nodes[ID][NODE];
    expect(rec.nodeId).toBe(NODE);
    expect(rec.meshcoreStatusError).toBe('no route');
  });

  it('updateMeshcoreOp patches existing record without clobbering other fields', () => {
    upsertNode(ID, { nodeId: NODE, longName: 'Repeater-A' });
    updatePosition(ID, { nodeId: NODE, latitude: 1, longitude: 2, timestamp: 123 });
    updateMeshcoreOp(ID, NODE, {
      meshcoreNodeStatus: {
        battMilliVolts: 4000,
        noiseFloor: -120,
        lastRssi: -90,
        lastSnr: 8,
        nPacketsRecv: 0,
        nPacketsSent: 0,
        totalAirTimeSecs: 0,
        totalUpTimeSecs: 0,
        nSentFlood: 0,
        nSentDirect: 0,
        nRecvFlood: 0,
        nRecvDirect: 0,
        errEvents: 0,
        nDirectDups: 0,
        nFloodDups: 0,
        currTxQueueLen: 0,
      },
    });
    const rec = useNodeStore.getState().nodes[ID][NODE];
    expect(rec.longName).toBe('Repeater-A');
    expect(rec.latitude).toBe(1);
    expect(rec.meshcoreNodeStatus?.battMilliVolts).toBe(4000);
  });

  it('appendMeshcoreCliEntry appends entries in order', () => {
    appendMeshcoreCliEntry(ID, NODE, { type: 'sent', text: 'log', timestamp: 1 });
    appendMeshcoreCliEntry(ID, NODE, { type: 'received', text: 'ok', timestamp: 2 });
    const history = useNodeStore.getState().nodes[ID][NODE].meshcoreCliHistory;
    expect(history).toHaveLength(2);
    expect(history?.[0].text).toBe('log');
    expect(history?.[1].text).toBe('ok');
  });

  it('clearMeshcoreCliHistory empties the array but keeps node record', () => {
    upsertNode(ID, { nodeId: NODE, longName: 'X' });
    appendMeshcoreCliEntry(ID, NODE, { type: 'sent', text: 'log', timestamp: 1 });
    clearMeshcoreCliHistory(ID, NODE);
    const rec = useNodeStore.getState().nodes[ID][NODE];
    expect(rec.meshcoreCliHistory).toEqual([]);
    expect(rec.longName).toBe('X');
  });

  it('clearMeshcoreCliHistory is a no-op when node does not exist', () => {
    clearMeshcoreCliHistory(ID, 999);
    expect(useNodeStore.getState().nodes[ID]?.[999]).toBeUndefined();
  });
});

describe('patchNodeFavorited', () => {
  afterEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('sets favorited on an existing node without clobbering other fields', () => {
    upsertNode(ID, { nodeId: NODE, longName: 'Alpha' });
    patchNodeFavorited(ID, NODE, true);
    const rec = useNodeStore.getState().nodes[ID][NODE];
    expect(rec.favorited).toBe(true);
    expect(rec.longName).toBe('Alpha');
  });

  it('creates a minimal node record when none exists', () => {
    patchNodeFavorited(ID, NODE, true);
    const rec = useNodeStore.getState().nodes[ID][NODE];
    expect(rec.nodeId).toBe(NODE);
    expect(rec.favorited).toBe(true);
  });
});

describe('removeNode', () => {
  afterEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('removes a single node without clearing sibling nodes', () => {
    upsertNode(ID, { nodeId: NODE, longName: 'Alpha' });
    upsertNode(ID, { nodeId: NODE + 1, longName: 'Beta' });
    removeNode(ID, NODE);
    expect(useNodeStore.getState().nodes[ID]?.[NODE]).toBeUndefined();
    expect(useNodeStore.getState().nodes[ID]?.[NODE + 1]?.longName).toBe('Beta');
  });

  it('is a no-op when the node is absent', () => {
    upsertNode(ID, { nodeId: NODE, longName: 'Alpha' });
    removeNode(ID, 999);
    expect(useNodeStore.getState().nodes[ID]?.[NODE]?.longName).toBe('Alpha');
  });
});

describe('mergeNode nodeId guard', () => {
  afterEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('keeps bucket nodeId when patch includes a conflicting nodeId', () => {
    updateMeshcoreOp(ID, NODE, { nodeId: 999 } as Parameters<typeof updateMeshcoreOp>[2]);
    const rec = useNodeStore.getState().nodes[ID][NODE];
    expect(rec.nodeId).toBe(NODE);
    expect(useNodeStore.getState().nodes[ID][999]).toBeUndefined();
  });
});

describe('nodeStore Meshtastic packet operations', () => {
  afterEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('merges identity, position, and telemetry without clobbering prior fields', () => {
    upsertNode(ID, {
      nodeId: NODE,
      longName: 'Alpha',
      shortName: 'ALP',
      role: 2,
    });
    updatePosition(ID, {
      nodeId: NODE,
      latitude: 39.7,
      longitude: -105,
      altitude: 1600,
      timestamp: 1000,
    });
    updateTelemetry(ID, {
      nodeId: NODE,
      timestamp: 2000,
      variantCase: 'environmentMetrics',
      batteryLevel: 88,
      voltage: 4.1,
      temperature: 20,
      relativeHumidity: 40,
      barometricPressure: 850,
      iaq: 12,
    });

    expect(useNodeStore.getState().nodes[ID][NODE]).toEqual(
      expect.objectContaining({
        longName: 'Alpha',
        shortName: 'ALP',
        role: 2,
        latitude: 39.7,
        longitude: -105,
        altitude: 1600,
        batteryLevel: 88,
        voltage: 4.1,
        temperature: 20,
        relativeHumidity: 40,
        barometricPressure: 850,
        iaq: 12,
      }),
    );
  });

  it('upserts full and batched records without replacing unrelated nodes', () => {
    upsertNodeRecord(ID, { nodeId: NODE, longName: 'Alpha', snr: 7 });
    upsertNodeRecordsForIdentity(ID, [
      { nodeId: NODE, rssi: -90 },
      { nodeId: 43, longName: 'Beta' },
    ]);

    expect(useNodeStore.getState().nodes[ID][NODE]).toEqual(
      expect.objectContaining({ longName: 'Alpha', snr: 7, rssi: -90 }),
    );
    expect(useNodeStore.getState().nodes[ID][43].longName).toBe('Beta');
  });

  it('stores route, waypoint, and neighbor event collections by identity', () => {
    addTraceRoute(ID, {
      from: NODE,
      to: 43,
      route: [7, 8],
      timestamp: 1000,
    });
    upsertWaypoint(ID, {
      id: 5,
      from: NODE,
      name: 'Trailhead',
      latitude: 39,
      longitude: -104,
      timestamp: 1000,
    });
    upsertNeighborInfo(ID, {
      nodeId: NODE,
      neighbors: [{ nodeId: 43, snr: 4, lastRxTime: 99 }],
      timestamp: 1000,
    });

    const state = useNodeStore.getState();
    expect(state.traceRoutes[ID][0].route).toEqual([7, 8]);
    expect(state.waypoints[ID][5].from).toBe(NODE);
    expect(state.neighborInfo[ID][NODE].neighbors[0].nodeId).toBe(43);
  });

  it('clears every identity-scoped node collection together', () => {
    upsertNodeRecord(ID, { nodeId: NODE });
    upsertWaypoint(ID, {
      id: 5,
      from: NODE,
      name: 'Trailhead',
      latitude: 1,
      longitude: 2,
      timestamp: 1,
    });
    addTraceRoute(ID, {
      from: NODE,
      to: 43,
      route: [7, 8],
      timestamp: 1000,
    });
    upsertNeighborInfo(ID, {
      nodeId: NODE,
      neighbors: [{ nodeId: 43, snr: 4, lastRxTime: 99 }],
      timestamp: 1000,
    });
    clearNodeIdentity(ID);

    const state = useNodeStore.getState();
    expect(state.nodes[ID]).toBeUndefined();
    expect(state.traceRoutes[ID]).toBeUndefined();
    expect(state.waypoints[ID]).toBeUndefined();
    expect(state.neighborInfo[ID]).toBeUndefined();
  });
});
