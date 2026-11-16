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

  it('includes MeshCore and Meshtastic chat #channels from live keys and device names', () => {
    const list = buildRoomJumpCandidates({
      identities: {
        mc1: identity('mc1', 'meshcore'),
        mt1: identity('mt1', 'meshtastic'),
      },
      nodesByIdentity: {},
      rrcHubDestHash: null,
      rrcRoomsByHub: undefined,
      liveChannelKeysByProtocol: {
        meshcore: { radioNodeId: 1, keyByIndex: { 0: 'aaa', 2: 'bbb' } },
        meshtastic: { radioNodeId: 2, keyByIndex: { 1: 'ccc' } },
      },
      connectedIdentityByProtocol: { meshcore: 'mc1', meshtastic: 'mt1' },
      devicesByIdentity: {
        mc1: {
          channels: [],
          channelConfigs: [],
          meshtasticConfigSlices: {},
          moduleConfigs: {},
          securityConfig: null,
          deviceOwner: null,
          deviceGpsMode: 0,
          deviceFixedPosition: null,
          telemetryDeviceUpdateInterval: null,
          ourPosition: null,
          rawPackets: [],
          deviceLogs: [],
          ringtone: null,
          meshtasticPortBuffers: { fromRadio: new Uint8Array(), toRadio: new Uint8Array() },
          meshcoreChannels: [
            { index: 0, name: 'public', secretHex: '00'.repeat(16) },
            { index: 2, name: '#weather', secretHex: '11'.repeat(16) },
          ],
        } as never,
        mt1: {
          channels: [{ index: 1, name: 'LongFast' }],
          channelConfigs: [],
          meshtasticConfigSlices: {},
          moduleConfigs: {},
          securityConfig: null,
          deviceOwner: null,
          deviceGpsMode: 0,
          deviceFixedPosition: null,
          telemetryDeviceUpdateInterval: null,
          ourPosition: null,
          rawPackets: [],
          deviceLogs: [],
          ringtone: null,
          meshtasticPortBuffers: { fromRadio: new Uint8Array(), toRadio: new Uint8Array() },
        } as never,
      },
    });
    const channels = list.filter(
      (c) => c.target.kind === 'meshcore-channel' || c.target.kind === 'meshtastic-channel',
    );
    expect(channels.map((c) => c.target.label).sort()).toEqual([
      '#LongFast',
      '#public',
      '#weather',
    ]);
    expect(channels.some((c) => c.target.kind === 'meshcore-channel')).toBe(true);
    expect(channels.some((c) => c.target.kind === 'meshtastic-channel')).toBe(true);
  });

  it('does not apply another identity live channel map to offline identities', () => {
    const list = buildRoomJumpCandidates({
      identities: {
        mc1: identity('mc1', 'meshcore'),
        mc2: identity('mc2', 'meshcore'),
      },
      nodesByIdentity: {},
      rrcHubDestHash: null,
      rrcRoomsByHub: undefined,
      liveChannelKeysByProtocol: {
        meshcore: { radioNodeId: 1, keyByIndex: { 0: 'live-only' } },
      },
      connectedIdentityByProtocol: { meshcore: 'mc1' },
      devicesByIdentity: {
        mc2: {
          channels: [],
          channelConfigs: [],
          meshtasticConfigSlices: {},
          moduleConfigs: {},
          securityConfig: null,
          deviceOwner: null,
          deviceGpsMode: 0,
          deviceFixedPosition: null,
          telemetryDeviceUpdateInterval: null,
          ourPosition: null,
          rawPackets: [],
          deviceLogs: [],
          ringtone: null,
          meshtasticPortBuffers: { fromRadio: new Uint8Array(), toRadio: new Uint8Array() },
          meshcoreChannels: [{ index: 3, name: 'stored', secretHex: '00'.repeat(16) }],
        } as never,
      },
    });
    const mc2 = list.filter(
      (c) => c.target.kind === 'meshcore-channel' && c.target.identityId === 'mc2',
    );
    expect(mc2).toHaveLength(1);
    expect(mc2[0]?.target).toMatchObject({ channelIndex: 3, label: '#stored' });
    expect(
      list.some(
        (c) =>
          c.target.kind === 'meshcore-channel' &&
          c.target.identityId === 'mc2' &&
          'channelKey' in c.target &&
          c.target.channelKey === 'live-only',
      ),
    ).toBe(false);
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
