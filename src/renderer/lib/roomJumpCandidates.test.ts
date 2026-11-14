import { describe, expect, it } from 'vitest';

import type { Protocol } from '@/renderer/lib/protocols/Protocol';
import { buildRoomJumpCandidates, roomJumpTargetKey } from '@/renderer/lib/roomJumpCandidates';
import type { IdentityRecord } from '@/renderer/stores/identityStore';

function fakeProtocol(type: 'meshtastic' | 'meshcore' | 'reticulum'): Protocol {
  return { type } as Protocol;
}

function identity(id: string, type: 'meshtastic' | 'meshcore' | 'reticulum'): IdentityRecord {
  return {
    id,
    protocol: fakeProtocol(type),
    signature: id,
    transports: [],
    createdAt: 1,
    lastSeenAt: 1,
  };
}

describe('buildRoomJumpCandidates', () => {
  it('includes MeshCore room nodes with lowercase hex and excludes non-rooms', () => {
    const pub = 'AB'.repeat(32);
    const list = buildRoomJumpCandidates({
      identities: {
        mc1: identity('mc1', 'meshcore'),
        mt1: identity('mt1', 'meshtastic'),
      },
      nodesByIdentity: {
        mc1: {
          1: { nodeId: 1, hwModel: 'Room', publicKeyHex: pub, longName: 'Weather' },
          2: { nodeId: 2, hwModel: 'Repeater', publicKeyHex: 'cd'.repeat(32), longName: 'Rpt' },
          3: { nodeId: 3, hwModel: 'Room', publicKeyHex: 'zz', longName: 'Bad' },
        },
      },
      rrcHubDestHash: null,
      rrcRoomsByHub: undefined,
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.target).toEqual({
      kind: 'meshcore-room',
      identityId: 'mc1',
      roomPubKeyHex: pub.toLowerCase(),
      label: 'Weather',
    });
    expect(list[0]?.key).toBe(roomJumpTargetKey(list[0].target));
  });

  it('includes read-only MeshCore rooms without credential filter', () => {
    const pub = 'ef'.repeat(32);
    const list = buildRoomJumpCandidates({
      identities: { mc1: identity('mc1', 'meshcore') },
      nodesByIdentity: {
        mc1: {
          9: { nodeId: 9, hwModel: 'Room', publicKeyHex: pub, longName: 'ReadOnly' },
        },
      },
      rrcHubDestHash: null,
      rrcRoomsByHub: undefined,
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.target.kind).toBe('meshcore-room');
  });

  it('derives lowercase hex from publicKey when publicKeyHex is absent', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i);
    const pub = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const list = buildRoomJumpCandidates({
      identities: { mc1: identity('mc1', 'meshcore') },
      nodesByIdentity: {
        mc1: {
          4: { nodeId: 4, hwModel: 'Room', publicKey: bytes, longName: 'BytesRoom' },
          5: { nodeId: 5, hwModel: 'Room', publicKey: new Uint8Array(8), longName: 'Short' },
        },
      },
      rrcHubDestHash: null,
      rrcRoomsByHub: undefined,
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.target).toEqual({
      kind: 'meshcore-room',
      identityId: 'mc1',
      roomPubKeyHex: pub,
      label: 'BytesRoom',
    });
  });

  it('dedupes RRC joined + recent by match key; no hub → no RRC', () => {
    const hub = 'aabbccdd';
    const rooms = new Map([['#General', {}]]);
    const withHub = buildRoomJumpCandidates({
      identities: {},
      nodesByIdentity: {},
      rrcHubDestHash: hub,
      rrcRoomsByHub: new Map([[hub, rooms]]),
      rrcRecentRooms: ['general', '#Lobby'],
      rrcHubDisplayName: 'Hub',
    });
    const keys = withHub.map((c) => c.key);
    expect(keys).toContain(`rrc:${hub}:general`);
    expect(keys).toContain(`rrc:${hub}:lobby`);
    expect(keys.filter((k) => k.includes('general'))).toHaveLength(1);

    const noHub = buildRoomJumpCandidates({
      identities: {},
      nodesByIdentity: {},
      rrcHubDestHash: null,
      rrcRoomsByHub: new Map([[hub, rooms]]),
      rrcRecentRooms: ['#General'],
    });
    expect(noHub.filter((c) => c.target.kind === 'rrc-room')).toHaveLength(0);
  });
});
