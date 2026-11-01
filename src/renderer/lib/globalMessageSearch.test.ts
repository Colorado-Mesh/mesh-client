import { describe, expect, it, vi } from 'vitest';

import type { GlobalMessageSearchHit } from './globalMessageSearch';
import {
  filterGlobalMessageSearchHits,
  findMessageIndexForFocus,
  isGlobalMessageSearchShortcut,
  normalizeMeshcoreSearchRow,
  normalizeMeshtasticSearchRow,
  normalizeReticulumSearchRow,
  runGlobalMessageSearch,
} from './globalMessageSearch';

describe('normalize*SearchRow', () => {
  it('maps Meshtastic channel vs DM', () => {
    const ch = normalizeMeshtasticSearchRow({
      id: 1,
      sender_id: 10,
      sender_name: 'A',
      payload: 'hi',
      channel: 2,
      timestamp: 100,
      to_node: null,
    });
    expect(ch.channel).toBe(2);
    expect(ch.dmPeer).toBeNull();

    const dm = normalizeMeshtasticSearchRow({
      id: 2,
      sender_id: 10,
      payload: 'dm',
      channel: 0,
      timestamp: 101,
      to_node: 99,
    });
    expect(dm.channel).toBeNull();
    expect(dm.dmPeer).toBe(10);
  });

  it('uses to_node as Meshtastic DM peer only for own outbound rows', () => {
    const own = new Set([10]);
    const outbound = normalizeMeshtasticSearchRow(
      { id: 2, sender_id: 10, payload: 'dm', channel: 0, timestamp: 101, to_node: 99 },
      own,
    );
    expect(outbound.dmPeer).toBe(99);

    const inbound = normalizeMeshtasticSearchRow(
      { id: 3, sender_id: 55, payload: 'hi', channel: 0, timestamp: 102, to_node: 10 },
      own,
    );
    expect(inbound.dmPeer).toBe(55);
    expect(
      filterGlobalMessageSearchHits([inbound], { protocol: 'all', conversation: 'dm:55' }),
    ).toEqual([inbound]);
  });

  it('maps MeshCore channel_idx -1 as DM', () => {
    const hit = normalizeMeshcoreSearchRow({
      id: 3,
      sender_id: 1,
      payload: 'x',
      channel_idx: -1,
      timestamp: 1,
      to_node: 42,
    });
    expect(hit.protocol).toBe('meshcore');
    expect(hit.channel).toBeNull();
    expect(hit.dmPeer).toBe(1);
  });

  it('uses to_node as MeshCore DM peer only for own outbound rows', () => {
    const own = new Set([1]);
    expect(
      normalizeMeshcoreSearchRow(
        { id: 3, sender_id: 1, payload: 'x', channel_idx: -1, timestamp: 1, to_node: 42 },
        own,
      ).dmPeer,
    ).toBe(42);
    expect(
      normalizeMeshcoreSearchRow(
        { id: 4, sender_id: 42, payload: 'y', channel_idx: -1, timestamp: 2, to_node: 1 },
        own,
      ).dmPeer,
    ).toBe(42);
  });

  it('maps Reticulum hashes', () => {
    const hit = normalizeReticulumSearchRow({
      id: 4,
      sender_id: 'aabbccddeeff00112233445566778899',
      sender_name: 'Peer',
      payload: 'voice',
      timestamp: 9,
      to_hash: '11223344556677889900aabbccddeeff',
      message_hash: 'deadbeef',
    });
    expect(hit.protocol).toBe('reticulum');
    expect(hit.reticulumPeerHash).toBe('aabbccddeeff00112233445566778899');
    expect(hit.reticulumSenderHash).toBe('aabbccddeeff00112233445566778899');
    expect(hit.reticulumMessageHash).toBe('deadbeef');
  });

  it('uses to_hash as Reticulum peer only for own outbound rows', () => {
    const own = new Set(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
    const outbound = normalizeReticulumSearchRow(
      {
        id: 5,
        sender_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        to_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        payload: 'out',
        timestamp: 1,
      },
      own,
    );
    expect(outbound.reticulumPeerHash).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(outbound.reticulumSenderHash).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(
      filterGlobalMessageSearchHits([outbound], {
        protocol: 'reticulum',
        direction: 'outbound',
        ownReticulumHashes: own,
      }),
    ).toEqual([outbound]);
  });
});

describe('filterGlobalMessageSearchHits', () => {
  const hits: GlobalMessageSearchHit[] = [
    {
      protocol: 'meshtastic',
      dbId: 1,
      timestamp: 1000,
      senderId: 1,
      senderName: 'Alpha',
      payload: 'hello world',
      channel: 0,
      dmPeer: null,
      reticulumPeerHash: null,
      reticulumMessageHash: null,
      packetId: null,
    },
    {
      protocol: 'meshcore',
      dbId: 2,
      timestamp: 2000,
      senderId: 2,
      senderName: 'Beta',
      payload: 'other',
      channel: null,
      dmPeer: 9,
      reticulumPeerHash: null,
      reticulumMessageHash: null,
      packetId: null,
    },
  ];

  it('filters by protocol and sender', () => {
    expect(
      filterGlobalMessageSearchHits(hits, { protocol: 'meshtastic', senderQuery: 'alp' }),
    ).toHaveLength(1);
    expect(filterGlobalMessageSearchHits(hits, { protocol: 'all', conversation: 'dm:9' })).toEqual([
      hits[1],
    ]);
  });

  it('filters by date range and direction', () => {
    expect(filterGlobalMessageSearchHits(hits, { protocol: 'all', fromTs: 1500 })).toHaveLength(1);
    expect(
      filterGlobalMessageSearchHits(hits, {
        protocol: 'all',
        direction: 'outbound',
        ownNodeIds: new Set([1]),
      }),
    ).toEqual([hits[0]]);
  });
});

describe('runGlobalMessageSearch', () => {
  it('queries enabled protocols and merges newest-first', async () => {
    const api = {
      searchMessages: vi
        .fn()
        .mockResolvedValue([
          { id: 1, sender_name: 'A', payload: 'one', channel: 0, timestamp: 10 },
        ]),
      searchMeshcoreMessages: vi
        .fn()
        .mockResolvedValue([
          { id: 2, sender_name: 'B', payload: 'two', channel_idx: 0, timestamp: 20 },
        ]),
      searchReticulumMessages: vi.fn().mockResolvedValue([
        {
          id: 3,
          sender_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          payload: 'three',
          timestamp: 15,
        },
      ]),
    };
    const hits = await runGlobalMessageSearch({
      query: 'o',
      filters: { protocol: 'all' },
      api,
      reticulumIdentityId: 'id-1',
      enabledProtocols: ['meshtastic', 'meshcore', 'reticulum'],
    });
    expect(api.searchMessages).toHaveBeenCalled();
    expect(api.searchMeshcoreMessages).toHaveBeenCalled();
    expect(api.searchReticulumMessages).toHaveBeenCalledWith('id-1', 'o', 50);
    expect(hits.map((h) => h.timestamp)).toEqual([20, 15, 10]);
  });

  it('skips reticulum without identity', async () => {
    const api = {
      searchMessages: vi.fn().mockResolvedValue([]),
      searchMeshcoreMessages: vi.fn().mockResolvedValue([]),
      searchReticulumMessages: vi.fn().mockResolvedValue([]),
    };
    await runGlobalMessageSearch({
      query: 'x',
      filters: { protocol: 'all' },
      api,
      enabledProtocols: ['reticulum'],
    });
    expect(api.searchReticulumMessages).not.toHaveBeenCalled();
  });
});

describe('findMessageIndexForFocus', () => {
  it('prefers hash then packetId then timestamp', () => {
    const messages = [
      { id: 1, timestamp: 10, packetId: 5 },
      { id: 2, timestamp: 20, reticulum_message_hash: 'abc' },
      { id: 3, timestamp: 30 },
    ];
    expect(findMessageIndexForFocus(messages, { timestamp: 20, reticulumMessageHash: 'ABC' })).toBe(
      1,
    );
    expect(findMessageIndexForFocus(messages, { timestamp: 10, packetId: 5 })).toBe(0);
    expect(findMessageIndexForFocus(messages, { timestamp: 30 })).toBe(2);
  });
});

describe('isGlobalMessageSearchShortcut', () => {
  it('matches Ctrl/Cmd+Shift+F', () => {
    expect(
      isGlobalMessageSearchShortcut(
        { key: 'f', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false } as KeyboardEvent,
        'darwin',
      ),
    ).toBe(true);
    expect(
      isGlobalMessageSearchShortcut(
        { key: 'f', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false } as KeyboardEvent,
        'linux',
      ),
    ).toBe(true);
    expect(
      isGlobalMessageSearchShortcut(
        {
          key: 'f',
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
        } as KeyboardEvent,
        'darwin',
      ),
    ).toBe(false);
  });
});
