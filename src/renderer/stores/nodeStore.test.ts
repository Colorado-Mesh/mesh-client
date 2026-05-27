import { afterEach, describe, expect, it } from 'vitest';

import {
  appendMeshcoreCliEntry,
  clearMeshcoreCliHistory,
  updateMeshcoreOp,
  updatePosition,
  upsertNode,
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
