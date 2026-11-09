import { describe, expect, it } from 'vitest';

import type { MeshNode } from '@/renderer/lib/types';
import type { TeamMember } from '@/shared/teamRosterTypes';

import { resolveLinkPresence, resolveMemberPresence } from './contactPresence';

function node(partial: Partial<MeshNode> & { node_id: number }): MeshNode {
  return {
    long_name: '',
    short_name: '',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    ...partial,
  };
}

describe('contactPresence', () => {
  it('marks a recently heard meshtastic link online', () => {
    const now = Date.now();
    const snap = resolveLinkPresence(
      { protocol: 'meshtastic', durableKey: '42', nodeId: 42, longName: 'Alpha' },
      {
        meshtastic: new Map([
          [42, node({ node_id: 42, last_heard: now - 60_000, long_name: 'Alpha' })],
        ]),
      },
      new Map(),
      now,
    );
    expect(snap.status).toBe('online');
    expect(snap.peerNodeId).toBe(42);
    expect(snap.displayName).toBe('Alpha');
  });

  it('resolves meshcore by pubkey when nodeId is missing', () => {
    const now = Date.now();
    const pubkey = 'ab'.repeat(32);
    const snap = resolveLinkPresence(
      { protocol: 'meshcore', durableKey: pubkey },
      {
        meshcore: new Map([
          [
            9,
            node({ node_id: 9, last_heard: now - 1000, public_key_hex: pubkey, long_name: 'MC' }),
          ],
        ]),
      },
      new Map(),
      now,
    );
    expect(snap.peerNodeId).toBe(9);
    expect(snap.status).toBe('online');
  });

  it('picks last-active by newest lastHeard and aggregates best status', () => {
    const now = Date.now();
    const member: TeamMember = {
      unitId: 1,
      callsign: 'Ops',
      isSelf: false,
      onRoster: true,
      createdAt: 1,
      updatedAt: 1,
      links: [
        { protocol: 'meshtastic', durableKey: '1', nodeId: 1 },
        { protocol: 'reticulum', durableKey: 'cd'.repeat(16) },
      ],
    };
    const presence = resolveMemberPresence(
      member,
      {
        meshtastic: new Map([
          [1, node({ node_id: 1, last_heard: now - 3 * 3_600_000 })], // stale (meshtastic)
        ]),
      },
      new Map([['cd'.repeat(16), { lastHeardMs: now - 30_000, displayName: 'Peer' }]]),
      now,
    );
    expect(presence.aggregateStatus).toBe('online');
    expect(presence.lastActive?.link.protocol).toBe('reticulum');
  });
});
