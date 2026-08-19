import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetMeshtasticConfigurePhaseForTests,
  setMeshtasticConfigurePhase,
} from '../lib/meshtastic/meshtasticConfigurePhase';
import { getNodeStatus } from '../lib/nodeStatus';
import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { MS_PER_DAY } from '../lib/timeConstants';
import { setConnection } from './connectionStore';
import { addIdentity } from './identityStore';
import {
  bumpMeshtasticNodesLastHeardAt,
  updatePosition,
  updateTelemetry,
  upsertNode,
  useNodeStore,
} from './nodeStore';

const ID_MT = 'id-mt-config-replay';
const PEER = 42;
const MY_NODE = 1;
const NOW = new Date('2026-08-19T20:48:30.000Z').getTime();

function seedPeer(lastHeardAt: number): void {
  useNodeStore.setState({
    nodes: { [ID_MT]: { [PEER]: { nodeId: PEER, lastHeardAt } } },
    traceRoutes: {},
    waypoints: {},
    neighborInfo: {},
  });
}

describe('nodeStore configure replay last_heard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetMeshtasticConfigurePhaseForTests();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'meshtastic:config-replay',
      transports: [],
      createdAt: NOW,
      lastSeenAt: NOW,
    });
    setConnection(ID_MT, { myNodeNum: MY_NODE, status: 'connected', connectionType: 'ble' });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetMeshtasticConfigurePhaseForTests();
  });

  it('does not bump UserPacket last_heard during configure', () => {
    const staleMs = NOW - 7 * MS_PER_DAY;
    seedPeer(staleMs);
    setMeshtasticConfigurePhase(true);
    upsertNode(ID_MT, {
      nodeId: PEER,
      fromUserPacket: true,
      lastHeardAt: NOW,
      longName: 'Peer',
    });
    expect(useNodeStore.getState().nodes[ID_MT][PEER].lastHeardAt).toBe(staleMs);
  });

  it('bumps UserPacket last_heard after configure', () => {
    const staleMs = NOW - 7 * MS_PER_DAY;
    seedPeer(staleMs);
    setMeshtasticConfigurePhase(false);
    upsertNode(ID_MT, {
      nodeId: PEER,
      fromUserPacket: true,
      lastHeardAt: NOW,
      longName: 'Peer',
    });
    expect(useNodeStore.getState().nodes[ID_MT][PEER].lastHeardAt).toBe(NOW);
  });

  it('UserPacket path preserves epoch ms (does not treat as NodeDB seconds)', () => {
    const staleMs = NOW - 7 * MS_PER_DAY;
    seedPeer(staleMs);
    setMeshtasticConfigurePhase(false);
    const rxMs = NOW - 60_000;
    upsertNode(ID_MT, {
      nodeId: PEER,
      fromUserPacket: true,
      lastHeardAt: rxMs,
      longName: 'Peer',
    });
    expect(useNodeStore.getState().nodes[ID_MT][PEER].lastHeardAt).toBe(rxMs);
  });

  it('applies NodeDB radio lastHeard during configure', () => {
    const staleMs = NOW - 7 * MS_PER_DAY;
    seedPeer(staleMs);
    setMeshtasticConfigurePhase(true);
    const radioSec = Math.floor((NOW - 3_600_000) / 1000);
    upsertNode(ID_MT, {
      nodeId: PEER,
      fromUserPacket: false,
      lastHeardAt: radioSec,
      longName: 'Peer',
    });
    expect(useNodeStore.getState().nodes[ID_MT][PEER].lastHeardAt).toBe(radioSec * 1000);
  });

  it('NodeDB preserves fresher client last_heard over stale radio', () => {
    const clientMs = NOW - 60_000;
    seedPeer(clientMs);
    setMeshtasticConfigurePhase(true);
    const radioSec = Math.floor((NOW - 7 * MS_PER_DAY) / 1000);
    upsertNode(ID_MT, {
      nodeId: PEER,
      fromUserPacket: false,
      lastHeardAt: radioSec,
      longName: 'Peer',
    });
    expect(useNodeStore.getState().nodes[ID_MT][PEER].lastHeardAt).toBe(clientMs);
  });

  it('NodeDB applies fresher radio last_heard over stale client during configure', () => {
    const clientMs = NOW - 3_600_000;
    seedPeer(clientMs);
    setMeshtasticConfigurePhase(true);
    const radioSec = Math.floor((NOW - 1_800_000) / 1000);
    upsertNode(ID_MT, {
      nodeId: PEER,
      fromUserPacket: false,
      lastHeardAt: radioSec,
      longName: 'Peer',
    });
    expect(useNodeStore.getState().nodes[ID_MT][PEER].lastHeardAt).toBe(radioSec * 1000);
  });

  it('does not bump position last_heard during configure', () => {
    const staleMs = NOW - 7 * MS_PER_DAY;
    seedPeer(staleMs);
    setMeshtasticConfigurePhase(true);
    updatePosition(ID_MT, {
      nodeId: PEER,
      latitude: 39.7,
      longitude: -105,
      timestamp: NOW,
    });
    const node = useNodeStore.getState().nodes[ID_MT][PEER];
    expect(node.lastHeardAt).toBe(staleMs);
    expect(node.latitude).toBe(39.7);
  });

  it('bumps position last_heard after configure', () => {
    seedPeer(0);
    setMeshtasticConfigurePhase(false);
    updatePosition(ID_MT, {
      nodeId: PEER,
      latitude: 39.7,
      longitude: -105,
      timestamp: NOW,
    });
    expect(useNodeStore.getState().nodes[ID_MT][PEER].lastHeardAt).toBe(NOW);
  });

  it('does not bump telemetry last_heard during configure', () => {
    const staleMs = NOW - 7 * MS_PER_DAY;
    seedPeer(staleMs);
    setMeshtasticConfigurePhase(true);
    updateTelemetry(ID_MT, {
      nodeId: PEER,
      timestamp: NOW,
      batteryLevel: 80,
      variantCase: 'deviceMetrics',
    });
    expect(useNodeStore.getState().nodes[ID_MT][PEER].lastHeardAt).toBe(staleMs);
  });

  it('does not bump traceroute last_heard during configure', () => {
    const staleMs = NOW - 7 * MS_PER_DAY;
    seedPeer(staleMs);
    setMeshtasticConfigurePhase(true);
    bumpMeshtasticNodesLastHeardAt(ID_MT, [PEER], NOW);
    expect(useNodeStore.getState().nodes[ID_MT][PEER].lastHeardAt).toBe(staleMs);
  });

  it('bumps traceroute last_heard after configure', () => {
    const staleMs = NOW - 7 * MS_PER_DAY;
    seedPeer(staleMs);
    setMeshtasticConfigurePhase(false);
    bumpMeshtasticNodesLastHeardAt(ID_MT, [PEER], NOW);
    expect(useNodeStore.getState().nodes[ID_MT][PEER].lastHeardAt).toBe(NOW);
  });

  it('self node NodeDB with zero lastHeard still falls back to now during configure', () => {
    setMeshtasticConfigurePhase(true);
    upsertNode(ID_MT, {
      nodeId: MY_NODE,
      fromUserPacket: false,
      lastHeardAt: 0,
      longName: 'Self',
    });
    const lastHeardAt = useNodeStore.getState().nodes[ID_MT][MY_NODE].lastHeardAt;
    expect(lastHeardAt).toBe(NOW);
    expect(getNodeStatus(lastHeardAt!)).toBe('online');
  });
});
