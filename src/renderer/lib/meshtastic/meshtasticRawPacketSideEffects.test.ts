// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { useNodeStore } from '../../stores/nodeStore';
import {
  resetConnectedMeshcoreBleMacForTests,
  setConnectedMeshcoreBleMac,
} from '../connectedMeshcoreBleMac';
import { packetRouter } from '../drivers/PacketRouter';
import { syncNodesMapToIdentityStore } from '../hydrateIdentityStoresFromDb';
import { getIdentityNode } from '../identityStoreReads';
import { MESH_PROTOCOL_STORAGE_KEY } from '../storedMeshProtocol';
import type { MeshNode } from '../types';
import {
  attachMeshtasticRawPacketSideEffects,
  type MeshtasticRawPacketSideEffectsDeps,
} from './meshtasticRawPacketSideEffects';

const IDENTITY = 'id-raw-se';
const MY_NODE = 1;
const PEER = 99;
/** Nathan Blue — MeshCore BLE MAC cc:2e:e3:da:2e:2f */
const BLUE_NODE = 0xe3da2e2f;

function emptyNode(nodeId: number): MeshNode {
  return {
    node_id: nodeId,
    long_name: `N${nodeId}`,
    short_name: `N${nodeId}`,
    hw_model: '',
    battery: 0,
    snr: 0,
    rssi: 0,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
    source: 'rf',
    heard_via_mqtt_only: false,
  };
}

function makeDeps(overrides: Partial<MeshtasticRawPacketSideEffectsDeps> = {}) {
  const nodeMirror = new Map<number, MeshNode>([[PEER, emptyNode(PEER)]]);
  syncNodesMapToIdentityStore(IDENTITY, nodeMirror);
  const deps: MeshtasticRawPacketSideEffectsDeps = {
    getMyNodeNum: () => MY_NODE,
    getIsConfiguring: () => false,
    setRawPackets: vi.fn(),
    setSignalTelemetry: vi.fn(),
    touchLastData: vi.fn(),
    ...overrides,
  };
  return { deps };
}

describe('attachMeshtasticRawPacketSideEffects', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
    resetConnectedMeshcoreBleMacForTests();
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshtastic');
    window.electronAPI = {
      db: { saveNode: vi.fn().mockResolvedValue(undefined) },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConnectedMeshcoreBleMacForTests();
    localStorage.clear();
  });

  it('appends a sniffer log entry and records noise/path diagnostics', () => {
    const { deps } = makeDeps();
    const recordNoisePort = vi.spyOn(useDiagnosticsStore.getState(), 'recordNoisePort');
    const recordPacketPath = vi.spyOn(useDiagnosticsStore.getState(), 'recordPacketPath');
    const detach = attachMeshtasticRawPacketSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'raw_packet',
        payload: {
          ts: Date.now(),
          snr: 7.5,
          rssi: -90,
          raw: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
          fromNodeId: PEER,
          portLabel: 'TEXT_MESSAGE_APP',
          viaMqtt: false,
          hopsAway: 2,
          packetId: 12345,
          portnum: 1,
        },
      },
      IDENTITY,
    );
    expect(deps.touchLastData).toHaveBeenCalled();
    expect(deps.setRawPackets).toHaveBeenCalled();
    expect(deps.setSignalTelemetry).toHaveBeenCalled();
    expect(recordNoisePort).toHaveBeenCalledWith(PEER, 1);
    expect(recordPacketPath).toHaveBeenCalledWith(
      12345,
      PEER,
      expect.objectContaining({ transport: 'rf', snr: 7.5, rssi: -90 }),
    );
    detach();
  });

  it('patches SNR/hops and invokes processNodeUpdate for RF mesh packets', () => {
    const { deps } = makeDeps();
    const processNodeUpdate = vi
      .spyOn(useDiagnosticsStore.getState(), 'processNodeUpdate')
      .mockImplementation(() => {});
    const detach = attachMeshtasticRawPacketSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'raw_packet',
        payload: {
          ts: Date.now(),
          snr: 9.25,
          rssi: -80,
          raw: new Uint8Array([0xaa, 0xbb]),
          fromNodeId: PEER,
          portLabel: 'NODEINFO_APP',
          viaMqtt: false,
          hopsAway: 1,
          packetId: 7,
        },
      },
      IDENTITY,
    );
    const node = getIdentityNode(IDENTITY, PEER);
    expect(node?.snr).toBe(9.25);
    expect(node?.rssi).toBe(-80);
    expect(node?.hops_away).toBe(1);
    expect(window.electronAPI.db.saveNode).toHaveBeenCalled();
    expect(processNodeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ node_id: PEER, snr: 9.25, hops_away: 1 }),
      null,
      MY_NODE,
      expect.anything(),
    );
    detach();
  });

  it('skips sniffer log when the active protocol tab is not meshtastic', () => {
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshcore');
    const { deps } = makeDeps();
    const detach = attachMeshtasticRawPacketSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'raw_packet',
        payload: {
          ts: Date.now(),
          snr: 1,
          rssi: -100,
          raw: new Uint8Array([0x01]),
          fromNodeId: PEER,
          portLabel: 'TEXT_MESSAGE_APP',
          viaMqtt: false,
          packetId: 1,
          portnum: 1,
        },
      },
      IDENTITY,
    );
    expect(deps.setRawPackets).not.toHaveBeenCalled();
    // SNR patch still applies — diagnostics gating is tab-scoped, signal is not.
    expect(getIdentityNode(IDENTITY, PEER)?.snr).toBe(1);
    detach();
  });

  it('ignores events routed for a different identity', () => {
    const { deps } = makeDeps();
    const detach = attachMeshtasticRawPacketSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'raw_packet',
        payload: {
          ts: Date.now(),
          snr: 1,
          rssi: -100,
          raw: new Uint8Array([0x02]),
          fromNodeId: PEER,
          portLabel: 'TEXT_MESSAGE_APP',
          viaMqtt: false,
        },
      },
      'other-id',
    );
    expect(deps.touchLastData).not.toHaveBeenCalled();
    detach();
  });

  it('Nathan Blue: does not bump last_heard for MeshCore BLE MAC-derived node while MeshCore connected', () => {
    const staleHeard = Date.now() - 60_000;
    const nodeMirror = new Map<number, MeshNode>([
      [BLUE_NODE, { ...emptyNode(BLUE_NODE), last_heard: staleHeard, snr: 1 }],
    ]);
    syncNodesMapToIdentityStore(IDENTITY, nodeMirror);
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    const deps: MeshtasticRawPacketSideEffectsDeps = {
      getMyNodeNum: () => MY_NODE,
      getIsConfiguring: () => false,
      setRawPackets: vi.fn(),
      setSignalTelemetry: vi.fn(),
      touchLastData: vi.fn(),
    };
    const recordNoisePort = vi.spyOn(useDiagnosticsStore.getState(), 'recordNoisePort');
    const recordPacketPath = vi.spyOn(useDiagnosticsStore.getState(), 'recordPacketPath');
    const detach = attachMeshtasticRawPacketSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'raw_packet',
        payload: {
          ts: Date.now(),
          snr: 12,
          rssi: -70,
          raw: new Uint8Array([0xcc]),
          fromNodeId: BLUE_NODE,
          portLabel: 'TEXT_MESSAGE_APP',
          viaMqtt: false,
          hopsAway: 0,
          packetId: 42,
          portnum: 1,
        },
      },
      IDENTITY,
    );
    const node = getIdentityNode(IDENTITY, BLUE_NODE);
    expect(deps.touchLastData).toHaveBeenCalled();
    expect(node?.last_heard).toBe(staleHeard);
    expect(node?.snr).toBe(1);
    expect(window.electronAPI.db.saveNode).not.toHaveBeenCalled();
    expect(deps.setRawPackets).not.toHaveBeenCalled();
    expect(deps.setSignalTelemetry).not.toHaveBeenCalled();
    expect(recordNoisePort).not.toHaveBeenCalledWith(BLUE_NODE, expect.anything());
    expect(recordPacketPath).not.toHaveBeenCalledWith(
      expect.anything(),
      BLUE_NODE,
      expect.anything(),
    );
    detach();
  });

  it('still bumps last_heard for Blue MAC node when MeshCore BLE is disconnected', () => {
    const staleHeard = Date.now() - 60_000;
    const nodeMirror = new Map<number, MeshNode>([
      [BLUE_NODE, { ...emptyNode(BLUE_NODE), last_heard: staleHeard, snr: 1 }],
    ]);
    syncNodesMapToIdentityStore(IDENTITY, nodeMirror);
    const deps: MeshtasticRawPacketSideEffectsDeps = {
      getMyNodeNum: () => MY_NODE,
      getIsConfiguring: () => false,
      setRawPackets: vi.fn(),
      setSignalTelemetry: vi.fn(),
      touchLastData: vi.fn(),
    };
    const detach = attachMeshtasticRawPacketSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'raw_packet',
        payload: {
          ts: Date.now(),
          snr: 12,
          rssi: -70,
          raw: new Uint8Array([0xcc]),
          fromNodeId: BLUE_NODE,
          portLabel: 'TEXT_MESSAGE_APP',
          viaMqtt: false,
          hopsAway: 0,
          packetId: 43,
        },
      },
      IDENTITY,
    );
    const node = getIdentityNode(IDENTITY, BLUE_NODE);
    expect(node?.last_heard).toBeGreaterThan(staleHeard);
    expect(node?.snr).toBe(12);
    detach();
  });

  it('still bumps unrelated peers while MeshCore BLE is connected', () => {
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    const { deps } = makeDeps();
    const detach = attachMeshtasticRawPacketSideEffects(IDENTITY, deps);
    packetRouter.dispatch(
      {
        type: 'raw_packet',
        payload: {
          ts: Date.now(),
          snr: 5,
          rssi: -85,
          raw: new Uint8Array([0x01]),
          fromNodeId: PEER,
          portLabel: 'TEXT_MESSAGE_APP',
          viaMqtt: false,
          hopsAway: 2,
        },
      },
      IDENTITY,
    );
    expect(getIdentityNode(IDENTITY, PEER)?.snr).toBe(5);
    detach();
  });
});
