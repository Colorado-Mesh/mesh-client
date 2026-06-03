import { beforeEach, describe, expect, it } from 'vitest';

import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { addIdentity } from './identityStore';
import {
  bumpMeshtasticNodesLastHeardAt,
  patchMeshcoreNodeLastHeardAt,
  updatePosition,
  upsertNode,
  useNodeStore,
} from './nodeStore';

const ID_MC = 'id-mc-store';
const ID_MT = 'id-mt-store';

describe('nodeStore MeshCore / Meshtastic last-heard', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'meshcore:test',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'meshtastic:test',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  });

  it('patchMeshcoreNodeLastHeardAt raises lastHeardAt in store', () => {
    const oldSec = Math.floor(Date.now() / 1000) - 86_400;
    useNodeStore.setState({
      nodes: { [ID_MC]: { 9: { nodeId: 9, lastHeardAt: oldSec } } },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    const nowSec = Math.floor(Date.now() / 1000);
    patchMeshcoreNodeLastHeardAt(ID_MC, 9, nowSec);
    expect(useNodeStore.getState().nodes[ID_MC][9].lastHeardAt).toBeGreaterThanOrEqual(nowSec);
  });

  it('upsertNode merges Meshtastic NodeInfo lastHeard with computeNodeInfoLastHeardMs', () => {
    upsertNode(ID_MT, { nodeId: 0x51f7e502, lastHeardAt: 1_700_000_100 });
    const node = useNodeStore.getState().nodes[ID_MT][0x51f7e502];
    expect(node.lastHeardAt).toBe(1_700_000_100_000);
  });

  it('updatePosition bumps Meshtastic lastHeardAt from packet timestamp', () => {
    const rxMs = Date.now() - 5_000;
    useNodeStore.setState({
      nodes: { [ID_MT]: { 1: { nodeId: 1, lastHeardAt: 0 } } },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    updatePosition(ID_MT, {
      nodeId: 1,
      latitude: 40,
      longitude: -105,
      timestamp: rxMs,
    });
    expect(useNodeStore.getState().nodes[ID_MT][1].lastHeardAt).toBe(rxMs);
  });

  it('bumpMeshtasticNodesLastHeardAt merges traceroute hearers', () => {
    useNodeStore.setState({
      nodes: {
        [ID_MT]: {
          0x1111: { nodeId: 0x1111, lastHeardAt: 1000 },
          0x2222: { nodeId: 0x2222, lastHeardAt: 1000 },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    const ts = Date.now();
    bumpMeshtasticNodesLastHeardAt(ID_MT, [0x1111, 0x2222], ts);
    expect(useNodeStore.getState().nodes[ID_MT][0x1111].lastHeardAt).toBe(ts);
    expect(useNodeStore.getState().nodes[ID_MT][0x2222].lastHeardAt).toBe(ts);
  });
});
