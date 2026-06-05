import { beforeEach, describe, expect, it } from 'vitest';

import {
  syncMeshcoreNodesMapToIdentityStore,
  syncMeshtasticNodesMapToIdentityStore,
} from '../lib/hydrateIdentityStoresFromDb';
import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import type { MeshNode } from '../lib/types';
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

  it('upsertNode preserves MeshCore longName when advert omits advName', () => {
    upsertNode(ID_MC, { nodeId: 0xabc, longName: 'Mountain Repeater', hwModel: 'Repeater' });
    upsertNode(ID_MC, { nodeId: 0xabc, lastHeardAt: 1_700_000_300 });
    expect(useNodeStore.getState().nodes[ID_MC][0xabc].longName).toBe('Mountain Repeater');
    expect(useNodeStore.getState().nodes[ID_MC][0xabc].hwModel).toBe('Repeater');
  });

  it('upsertNode preserves MeshCore longName when advert sends empty advName', () => {
    upsertNode(ID_MC, { nodeId: 0xdef, longName: 'Solar Node', hwModel: 'Chat' });
    upsertNode(ID_MC, { nodeId: 0xdef, longName: '   ', lastHeardAt: 1_700_000_400 });
    expect(useNodeStore.getState().nodes[ID_MC][0xdef].longName).toBe('Solar Node');
    expect(useNodeStore.getState().nodes[ID_MC][0xdef].hwModel).toBe('Chat');
  });

  it('syncMeshcoreNodesMapToIdentityStore does not wipe store longName from sparse runtime rows', () => {
    upsertNode(ID_MC, { nodeId: 0x1234, longName: 'NVON Repeater', hwModel: 'Repeater' });
    const sparseRuntime = new Map<number, MeshNode>([
      [
        0x1234,
        {
          node_id: 0x1234,
          long_name: '',
          short_name: '',
          hw_model: '',
          battery: 0,
          snr: 0,
          rssi: 0,
          last_heard: Math.floor(Date.now() / 1000),
          latitude: null,
          longitude: null,
          source: 'rf',
          heard_via_mqtt_only: false,
        },
      ],
    ]);
    syncMeshcoreNodesMapToIdentityStore(ID_MC, sparseRuntime);
    expect(useNodeStore.getState().nodes[ID_MC][0x1234].longName).toBe('NVON Repeater');
    expect(useNodeStore.getState().nodes[ID_MC][0x1234].hwModel).toBe('Repeater');
  });

  it('upsertNode preserves longName when node_info omits user names', () => {
    upsertNode(ID_MT, { nodeId: 474578492, longName: 'CWW Home', shortName: 'CWW' });
    upsertNode(ID_MT, { nodeId: 474578492, lastHeardAt: 1_700_000_200 });
    expect(useNodeStore.getState().nodes[ID_MT][474578492].longName).toBe('CWW Home');
    expect(useNodeStore.getState().nodes[ID_MT][474578492].shortName).toBe('CWW');
  });

  it('syncMeshtasticNodesMapToIdentityStore does not wipe store longName from stub runtime rows', () => {
    upsertNode(ID_MT, {
      nodeId: 649425065,
      longName: 'NV0N QTH https:/coloradomesh.org',
      shortName: 'NV0N',
    });
    const stubRuntime = new Map<number, MeshNode>([
      [
        649425065,
        {
          node_id: 649425065,
          long_name: '',
          short_name: '',
          hw_model: '',
          battery: 0,
          snr: 0,
          rssi: 0,
          last_heard: Date.now(),
          latitude: null,
          longitude: null,
          source: 'rf',
          heard_via_mqtt_only: false,
        },
      ],
    ]);
    syncMeshtasticNodesMapToIdentityStore(ID_MT, stubRuntime);
    expect(useNodeStore.getState().nodes[ID_MT][649425065].longName).toBe(
      'NV0N QTH https:/coloradomesh.org',
    );
    expect(useNodeStore.getState().nodes[ID_MT][649425065].shortName).toBe('NV0N');
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
