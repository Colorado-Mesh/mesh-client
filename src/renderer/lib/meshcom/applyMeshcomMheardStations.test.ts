/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Test store buckets may be absent. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dbPersistRetry', () => ({
  persistDbWrite: vi.fn(),
}));

import { useNodeStore } from '../../stores/nodeStore';
import { buildMeshPeerTopologyGraph, resolveMeshPeerRelayId } from '../buildMeshPeerTopologyGraph';
import { nodeRecordsToMeshNodeMap } from '../storeRecordAdapters';
import { applyMeshcomMheardStations } from './applyMeshcomMheardStations';
import { clearMeshcomCallRegistry } from './meshcomCallRegistry';
import { callsignToNodeId } from './meshcomCallsign';

const ID = 'meshcom-session-test';

describe('applyMeshcomMheardStations', () => {
  beforeEach(() => {
    clearMeshcomCallRegistry();
    useNodeStore.setState({ nodes: {} });
  });

  it('marks direct stations as hopsAway 0 RF', () => {
    applyMeshcomMheardStations(ID, [{ callsign: 'OE1ABC-1', rssi: -80 }], 1_700_000_000_000);
    const id = callsignToNodeId('OE1ABC-1');
    const record = useNodeStore.getState().nodes[ID]?.[id];
    expect(record).toMatchObject({
      hopsAway: 0,
      source: 'rf',
      longName: 'OE1ABC-1',
    });
    expect(record?.path).toBeUndefined();
  });

  it('sets path, hops, and relay neighbors when VIA is present', () => {
    const selfId = callsignToNodeId('SELF-9');
    useNodeStore.setState({
      nodes: {
        [ID]: {
          [selfId]: { nodeId: selfId, longName: 'SELF-9', hopsAway: 0, source: 'rf' },
        },
      },
    });
    applyMeshcomMheardStations(
      ID,
      [{ callsign: 'DH1FR-2', via: 'OE1ABC-1', snr: 4.5 }],
      1_700_000_000_000,
    );
    const peerId = callsignToNodeId('DH1FR-2');
    const relayId = callsignToNodeId('OE1ABC-1');
    const peer = useNodeStore.getState().nodes[ID]?.[peerId];
    const relay = useNodeStore.getState().nodes[ID]?.[relayId];
    expect(peer).toMatchObject({ hopsAway: 2, path: [relayId, peerId], source: 'rf' });
    expect(relay?.neighbors?.some((n) => n.nodeId === peerId)).toBe(true);

    const meshNodes = nodeRecordsToMeshNodeMap(
      Object.values(useNodeStore.getState().nodes[ID] ?? {}),
    );
    expect(resolveMeshPeerRelayId(meshNodes.get(peerId)!, meshNodes, selfId)).toBe(relayId);

    const graph = buildMeshPeerTopologyGraph(meshNodes, {
      myNodeId: selfId,
      selfLabel: 'SELF',
      protocol: 'meshcom',
    });
    const relayEdge = graph.edges.find(
      (e) => e.source === String(relayId) && e.target === String(peerId),
    );
    expect(relayEdge?.kind).toBe('relay');
  });
});
