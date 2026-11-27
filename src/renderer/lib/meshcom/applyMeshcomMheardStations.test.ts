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
import {
  clearAllMeshcomLocallyDeletedContactsForTests,
  markMeshcomLocallyDeletedContact,
} from './meshcomLocallyDeletedContacts';

const ID = 'meshcom-session-test';

describe('applyMeshcomMheardStations', () => {
  beforeEach(() => {
    clearMeshcomCallRegistry();
    clearAllMeshcomLocallyDeletedContactsForTests();
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

  it('skips tombstoned stations but still updates a non-tombstoned via relay', () => {
    markMeshcomLocallyDeletedContact('GONE-1');
    applyMeshcomMheardStations(
      ID,
      [
        { callsign: 'GONE-1', via: 'RELAY-2', snr: 3 },
        { callsign: 'LIVE-3', rssi: -70, ageMin: 5 },
      ],
      1_700_000_000_000,
    );
    const goneId = callsignToNodeId('GONE-1');
    const relayId = callsignToNodeId('RELAY-2');
    const liveId = callsignToNodeId('LIVE-3');
    const bucket = useNodeStore.getState().nodes[ID] ?? {};
    expect(bucket[goneId]).toBeUndefined();
    expect(bucket[relayId]).toBeUndefined();
    expect(bucket[liveId]?.lastHeardAt).toBe(1_700_000_000_000 - 5 * 60_000);
  });

  it('subtracts reported ageMin from heardAt for lastHeardAt', () => {
    applyMeshcomMheardStations(ID, [{ callsign: 'AGE-1', ageMin: 2 }], 1_700_000_120_000);
    const id = callsignToNodeId('AGE-1');
    expect(useNodeStore.getState().nodes[ID]?.[id]?.lastHeardAt).toBe(1_700_000_000_000);
  });
});
