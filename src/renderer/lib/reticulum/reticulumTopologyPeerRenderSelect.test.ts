import { describe, expect, it } from 'vitest';

import {
  lastSeenRank,
  selectReticulumTopologyPeersForRender,
  TOPOLOGY_PEER_RENDER_CAP,
} from './reticulumTopologyPeerRenderSelect';

const rnode = { id: 'rnode-1', name: 'RNode 41F4', type: 'rnode' };
const tcp = { id: 'tcp-east', name: 'RNS_Transport_US-East', type: 'tcp' };

function peer(
  hash: string,
  iface: string,
  lastSeen: number,
): { destination_hash: string; interface: string; last_seen: number } {
  return { destination_hash: hash, interface: iface, last_seen: lastSeen };
}

describe('selectReticulumTopologyPeersForRender', () => {
  it('keeps stale RF peers when RF-only even if fresh TCP rows would win last_seen', () => {
    const rf = Array.from({ length: 20 }, (_, i) => peer(`rf${i}`, 'RNode 41F4', i));
    const tcpPeers = Array.from({ length: 2000 }, (_, i) =>
      peer(`tcp${i}`, 'RNS_Transport_US-East', 10_000 + i),
    );
    const selected = selectReticulumTopologyPeersForRender([...rf, ...tcpPeers], [rnode, tcp], {
      rfOnly: true,
    });
    expect(selected).toHaveLength(20);
    expect(selected.every((p) => p.destination_hash.startsWith('rf'))).toBe(true);
  });

  it('slices to 800 newest when RF-only is off', () => {
    const peers = Array.from({ length: 900 }, (_, i) => peer(`p${i}`, 'RNS_Transport_US-East', i));
    const selected = selectReticulumTopologyPeersForRender(peers, [tcp], { rfOnly: false });
    expect(selected).toHaveLength(TOPOLOGY_PEER_RENDER_CAP);
    expect(selected[0]?.destination_hash).toBe('p899');
    expect(selected[799]?.destination_hash).toBe('p100');
  });

  it('keeps all RF and drops TCP when under the ingest cap', () => {
    const rf = Array.from({ length: 50 }, (_, i) => peer(`rf${i}`, 'RNode 41F4', i));
    const tcpPeers = Array.from({ length: 100 }, (_, i) =>
      peer(`tcp${i}`, 'RNS_Transport_US-East', 1000 + i),
    );
    const selected = selectReticulumTopologyPeersForRender([...rf, ...tcpPeers], [rnode, tcp], {
      rfOnly: true,
    });
    expect(selected).toHaveLength(50);
    expect(selected.some((p) => p.destination_hash.startsWith('tcp'))).toBe(false);
  });

  it('ranks missing, NaN, and non-positive last_seen as oldest', () => {
    expect(lastSeenRank(undefined)).toBe(0);
    expect(lastSeenRank(null)).toBe(0);
    expect(lastSeenRank(Number.NaN)).toBe(0);
    expect(lastSeenRank(Number.POSITIVE_INFINITY)).toBe(0);
    expect(lastSeenRank(0)).toBe(0);
    expect(lastSeenRank(-1)).toBe(0);
    expect(lastSeenRank(1_700_000_000_000)).toBeGreaterThan(0);
  });

  it('drops NaN last_seen rows before finite ones when slicing', () => {
    const peers = [
      peer('nan', 'RNS_Transport_US-East', Number.NaN),
      ...Array.from({ length: 800 }, (_, i) => peer(`p${i}`, 'RNS_Transport_US-East', 1_000 + i)),
    ];
    const selected = selectReticulumTopologyPeersForRender(peers, [tcp], { rfOnly: false });
    expect(selected).toHaveLength(TOPOLOGY_PEER_RENDER_CAP);
    expect(selected.some((p) => p.destination_hash === 'nan')).toBe(false);
  });
});
