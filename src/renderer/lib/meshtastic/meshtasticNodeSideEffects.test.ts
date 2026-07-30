// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter } from '../drivers/PacketRouter';
import { getIdentityNode } from '../identityStoreReads';
import { MESH_PROTOCOL_STORAGE_KEY } from '../storedMeshProtocol';
import type { MeshNode } from '../types';
import {
  attachMeshtasticNodeSideEffects,
  type MeshtasticNodeSideEffectsDeps,
} from './meshtasticNodeSideEffects';

const IDENTITY = 'id-node-se';
const MY_NODE = 1;
const PEER = 42;

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
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshtastic');
    window.electronAPI = {
      db: { saveNode: vi.fn().mockResolvedValue(undefined) },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
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
});
