// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { addIdentity, useIdentityStore } from '../../stores/identityStore';
import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import {
  resetConnectedMeshcoreBleMacForTests,
  setConnectedMeshcoreBleMac,
} from '../connectedMeshcoreBleMac';
import { packetRouter } from '../drivers/PacketRouter';
import { getIdentityNode } from '../identityStoreReads';
import { meshtasticProtocol } from '../protocols/MeshtasticProtocol';
import { MESH_PROTOCOL_STORAGE_KEY } from '../storedMeshProtocol';
import { meshNodeToNodeRecord } from '../storeRecordAdapters';
import type { MeshNode } from '../types';
import {
  attachMeshtasticNodeSideEffects,
  type MeshtasticNodeSideEffectsDeps,
} from './meshtasticNodeSideEffects';

const IDENTITY = 'id-node-se';
const MY_NODE = 1;
const PEER = 42;
/** Nathan Blue MAC suffix — MeshCore BLE ghost nodeNum. */
const GHOST_NODE = 0xe3da2e2f;
const MESHCORE_BLE_MAC = 'cc:2e:e3:da:2e:2f';

function emptyNode(nodeId: number): MeshNode {
  return {
    node_id: nodeId,
    long_name: '',
    short_name: '',
    hw_model: '',
    battery: 0,
    snr: 0,
    rssi: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    source: 'rf',
    heard_via_mqtt_only: false,
  };
}

function makeDeps(overrides: Partial<MeshtasticNodeSideEffectsDeps> = {}) {
  const deps: MeshtasticNodeSideEffectsDeps = {
    connectionType: 'ble',
    getMyNodeNum: () => MY_NODE,
    getIsConfiguring: () => false,
    getBluetoothDeviceId: () => 'ble-1',
    touchLastData: vi.fn(),
    emptyNode,
    ensureNodeExists: vi.fn(),
    maybeRequestNodeInfoForNode: vi.fn(),
    applyOwnNodeBatteryFromDeviceMetrics: vi.fn(),
    rfHeardNodeIds: { current: new Set<number>() },
    setDeviceOwner: vi.fn(),
    setTelemetry: vi.fn(),
    setEnvironmentTelemetry: vi.fn(),
    ...overrides,
  };
  return { deps };
}

describe('attachMeshtasticNodeSideEffects', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    addIdentity({
      id: IDENTITY,
      protocol: meshtasticProtocol,
      signature: 'sig-node-se',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshtastic');
    resetConnectedMeshcoreBleMacForTests();
    window.electronAPI = {
      db: { saveNode: vi.fn().mockResolvedValue(undefined) },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetConnectedMeshcoreBleMacForTests();
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('applies UserPacket node_info into the hook map and marks RF-heard', () => {
    const { deps } = makeDeps();
    const detach = attachMeshtasticNodeSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'node_info',
        payload: {
          nodeId: PEER,
          longName: 'Peer Node',
          shortName: 'PEER',
          hwModel: 'TBEAM',
          fromUserPacket: true,
          lastHeardAt: Date.now(),
        },
      },
      IDENTITY,
    );
    expect(deps.touchLastData).toHaveBeenCalled();
    expect(deps.rfHeardNodeIds.current.has(PEER)).toBe(true);
    expect(getIdentityNode(IDENTITY, PEER)?.long_name).toBe('Peer Node');
    expect(getIdentityNode(IDENTITY, PEER)?.short_name).toBe('PEER');
    expect(window.electronAPI.db.saveNode).toHaveBeenCalled();
    detach();
  });

  it('patches valid position and requests NodeInfo for the sender', () => {
    const { deps } = makeDeps();
    const detach = attachMeshtasticNodeSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'position',
        payload: {
          nodeId: PEER,
          latitude: 39.7392,
          longitude: -104.9903,
          altitude: 1600,
          timestamp: Date.now(),
        },
      },
      IDENTITY,
    );
    expect(getIdentityNode(IDENTITY, PEER)?.latitude).toBeCloseTo(39.7392);
    expect(getIdentityNode(IDENTITY, PEER)?.longitude).toBeCloseTo(-104.9903);
    expect(deps.maybeRequestNodeInfoForNode).toHaveBeenCalledWith(PEER);
    detach();
  });

  it('charts deviceMetrics telemetry and updates battery on an existing node', () => {
    const { deps } = makeDeps();
    const detach = attachMeshtasticNodeSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'telemetry',
        payload: {
          nodeId: PEER,
          timestamp: Date.now(),
          batteryLevel: 77,
          voltage: 4.05,
          variantCase: 'deviceMetrics',
        },
      },
      IDENTITY,
    );
    expect(deps.setTelemetry).toHaveBeenCalled();
    expect(getIdentityNode(IDENTITY, PEER)?.battery).toBe(77);
    expect(deps.maybeRequestNodeInfoForNode).toHaveBeenCalledWith(PEER);
    detach();
  });

  it('passes the fully merged NodeDB row to diagnostics', () => {
    const processNodeUpdate = vi
      .spyOn(useDiagnosticsStore.getState(), 'processNodeUpdate')
      .mockImplementation(() => undefined);
    const { deps } = makeDeps();
    const detach = attachMeshtasticNodeSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'node_info',
        payload: {
          nodeId: PEER,
          longName: 'Peer Node',
          shortName: 'PEER',
          snr: 7.5,
          hopsAway: 2,
          latitude: 39.7,
          longitude: -105,
          lastHeardAt: Date.now(),
          fromUserPacket: false,
        },
      },
      IDENTITY,
    );
    expect(processNodeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        node_id: PEER,
        snr: 7.5,
        hops_away: 2,
        latitude: 39.7,
        longitude: -105,
      }),
      null,
      MY_NODE,
      expect.anything(),
    );
    detach();
  });

  it('creates an environment telemetry row from canonical nodeStore state', () => {
    const { deps } = makeDeps();
    const detach = attachMeshtasticNodeSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'telemetry',
        payload: {
          nodeId: PEER,
          timestamp: Date.now(),
          variantCase: 'environmentMetrics',
          temperature: 21.5,
          relativeHumidity: 45,
        },
      },
      IDENTITY,
    );
    expect(getIdentityNode(IDENTITY, PEER)).toEqual(
      expect.objectContaining({
        env_temperature: 21.5,
        env_humidity: 45,
      }),
    );
    detach();
  });

  it('ignores events routed for a different identity', () => {
    const { deps } = makeDeps();
    const detach = attachMeshtasticNodeSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'node_info',
        payload: {
          nodeId: PEER,
          longName: 'Other',
          shortName: 'OTH',
          fromUserPacket: true,
        },
      },
      'other-id',
    );
    expect(deps.touchLastData).not.toHaveBeenCalled();
    detach();
  });

  describe('MeshCore BLE ghost suppression', () => {
    const priorHeard = 1_700_000_000_000;

    beforeEach(() => {
      setConnectedMeshcoreBleMac(MESHCORE_BLE_MAC);
      upsertNodeRecord(
        IDENTITY,
        meshNodeToNodeRecord({
          ...emptyNode(GHOST_NODE),
          long_name: 'Blue',
          short_name: 'BLUE',
          last_heard: priorHeard,
        }),
      );
      vi.mocked(window.electronAPI.db.saveNode).mockClear();
    });

    it('does not bump last_heard on UserPacket node_info for the MAC ghost', () => {
      const { deps } = makeDeps();
      const detach = attachMeshtasticNodeSideEffects(IDENTITY, deps);
      packetRouter.dispatch(
        {
          type: 'node_info',
          payload: {
            nodeId: GHOST_NODE,
            longName: 'Blue',
            shortName: 'BLUE',
            fromUserPacket: true,
            lastHeardAt: Date.now(),
          },
        },
        IDENTITY,
      );
      expect(getIdentityNode(IDENTITY, GHOST_NODE)?.last_heard).toBe(priorHeard);
      expect(window.electronAPI.db.saveNode).not.toHaveBeenCalled();
      expect(deps.rfHeardNodeIds.current.has(GHOST_NODE)).toBe(false);
      detach();
    });

    it('does not bump last_heard on NodeDB node_info for the MAC ghost', () => {
      const { deps } = makeDeps();
      const detach = attachMeshtasticNodeSideEffects(IDENTITY, deps);
      packetRouter.dispatch(
        {
          type: 'node_info',
          payload: {
            nodeId: GHOST_NODE,
            longName: 'Blue',
            shortName: 'BLUE',
            snr: 9,
            hopsAway: 0,
            lastHeardAt: Date.now(),
            fromUserPacket: false,
          },
        },
        IDENTITY,
      );
      expect(getIdentityNode(IDENTITY, GHOST_NODE)?.last_heard).toBe(priorHeard);
      expect(getIdentityNode(IDENTITY, GHOST_NODE)?.snr).toBe(0);
      expect(window.electronAPI.db.saveNode).not.toHaveBeenCalled();
      detach();
    });

    it('does not bump last_heard on position for the MAC ghost', () => {
      const { deps } = makeDeps();
      const detach = attachMeshtasticNodeSideEffects(IDENTITY, deps);
      packetRouter.dispatch(
        {
          type: 'position',
          payload: {
            nodeId: GHOST_NODE,
            latitude: 39.7392,
            longitude: -104.9903,
            timestamp: Date.now(),
          },
        },
        IDENTITY,
      );
      expect(getIdentityNode(IDENTITY, GHOST_NODE)?.last_heard).toBe(priorHeard);
      expect(getIdentityNode(IDENTITY, GHOST_NODE)?.latitude).toBeNull();
      expect(window.electronAPI.db.saveNode).not.toHaveBeenCalled();
      detach();
    });

    it('does not bump last_heard on deviceMetrics telemetry for the MAC ghost', () => {
      const { deps } = makeDeps();
      const detach = attachMeshtasticNodeSideEffects(IDENTITY, deps);
      packetRouter.dispatch(
        {
          type: 'telemetry',
          payload: {
            nodeId: GHOST_NODE,
            timestamp: Date.now(),
            batteryLevel: 50,
            variantCase: 'deviceMetrics',
          },
        },
        IDENTITY,
      );
      expect(getIdentityNode(IDENTITY, GHOST_NODE)?.last_heard).toBe(priorHeard);
      expect(getIdentityNode(IDENTITY, GHOST_NODE)?.battery).toBe(0);
      expect(deps.setTelemetry).not.toHaveBeenCalled();
      expect(window.electronAPI.db.saveNode).not.toHaveBeenCalled();
      detach();
    });
  });
});
