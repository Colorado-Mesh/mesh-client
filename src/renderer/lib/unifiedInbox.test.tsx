import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from './types';
import {
  buildUnifiedInboxItems,
  formatInboxItemLine,
  inboxItemKey,
  inboxItemsToExportMessages,
  inboxItemToJumpTarget,
  isUnifiedInboxShortcut,
  loadDismissedInboxKeys,
  messageStarId,
  saveDismissedInboxKeys,
  UNIFIED_INBOX_DISMISSED_KEY,
  UNIFIED_INBOX_DISMISSED_LIMIT,
} from './unifiedInbox';

function msg(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: 1,
    sender_id: 10,
    sender_name: 'Alpha',
    payload: 'hello',
    channel: 0,
    timestamp: 1000,
    ...over,
  };
}

const EMPTY = { meshtastic: [], meshcore: [], reticulum: [] };

describe('buildUnifiedInboxItems', () => {
  it('merges protocols newest first and excludes own sends, reactions and empty payloads', () => {
    const items = buildUnifiedInboxItems({
      enabledProtocols: ['meshtastic', 'meshcore', 'reticulum'],
      ownNodeIdsByProtocol: { meshtastic: new Set([99]) },
      messagesByProtocol: {
        meshtastic: [
          msg({ id: 1, timestamp: 100 }),
          msg({ id: 2, sender_id: 99, timestamp: 900 }),
          msg({ id: 3, timestamp: 800, emoji: 1, replyId: 5 }),
          msg({ id: 4, timestamp: 700, payload: '' }),
        ],
        meshcore: [msg({ id: 5, timestamp: 300, channel: 2 })],
        reticulum: [
          msg({ id: undefined, storeId: 'abc', timestamp: 500, reticulum_message_hash: 'ab' }),
        ],
      },
    });
    expect(items.map((i) => i.key)).toEqual(['reticulum:500-x', 'meshcore:5', 'meshtastic:1']);
  });

  it('classifies DM vs channel and builds view keys', () => {
    const [bcast, dm, ret] = buildUnifiedInboxItems({
      enabledProtocols: ['meshtastic', 'reticulum'],
      messagesByProtocol: {
        ...EMPTY,
        meshtastic: [
          msg({ id: 1, timestamp: 3, to: 0xffffffff, channel: 4 }),
          msg({ id: 2, timestamp: 2, to: 77, sender_id: 12 }),
        ],
        reticulum: [msg({ id: 3, timestamp: 1, sender_id: 55 })],
      },
    });
    expect([bcast.isDirectMessage, bcast.viewKey]).toEqual([false, 'ch:4']);
    expect([dm.isDirectMessage, dm.viewKey]).toEqual([true, 'dm:12']);
    expect([ret.isDirectMessage, ret.viewKey]).toEqual([true, 'dm:55']);
  });

  it('respects disabled protocols, protocol filter, text query, dismissed keys and limit', () => {
    const messagesByProtocol = {
      ...EMPTY,
      meshtastic: [
        msg({ id: 1, timestamp: 3, payload: 'Pizza time' }),
        msg({ id: 2, timestamp: 2, payload: 'other', sender_name: 'Pizzeria' }),
        msg({ id: 3, timestamp: 1, payload: 'nope' }),
      ],
      meshcore: [msg({ id: 9, timestamp: 4 })],
    };
    const base = { messagesByProtocol, enabledProtocols: ['meshtastic'] as const };
    expect(buildUnifiedInboxItems(base).map((i) => i.protocol)).toEqual([
      'meshtastic',
      'meshtastic',
      'meshtastic',
    ]);
    expect(buildUnifiedInboxItems({ ...base, textQuery: 'pizz' })).toHaveLength(2);
    expect(buildUnifiedInboxItems({ ...base, dismissed: new Set(['meshtastic:1']) })).toHaveLength(
      2,
    );
    expect(buildUnifiedInboxItems({ ...base, limit: 1 })).toHaveLength(1);
    expect(
      buildUnifiedInboxItems({
        messagesByProtocol,
        enabledProtocols: ['meshtastic', 'meshcore'],
        protocolFilter: 'meshcore',
      }),
    ).toHaveLength(1);
  });
});

describe('inboxItemToJumpTarget', () => {
  it('maps channel, DM and Reticulum rows to search-hit targets', () => {
    const [ch, dm, ret] = buildUnifiedInboxItems({
      enabledProtocols: ['meshtastic', 'reticulum'],
      messagesByProtocol: {
        ...EMPTY,
        meshtastic: [
          msg({ id: 1, timestamp: 3, channel: 2, packetId: 42 }),
          msg({ id: 2, timestamp: 2, to: 7, sender_id: 12 }),
        ],
        reticulum: [
          msg({
            id: 3,
            timestamp: 1,
            reticulum_sender_hash: 'ABCD',
            reticulum_message_hash: 'EF01',
          }),
        ],
      },
    });
    expect(inboxItemToJumpTarget(ch)).toMatchObject({
      protocol: 'meshtastic',
      channel: 2,
      dmPeer: null,
      packetId: 42,
      dbId: 1,
    });
    expect(inboxItemToJumpTarget(dm)).toMatchObject({ channel: null, dmPeer: 12 });
    expect(inboxItemToJumpTarget(ret)).toMatchObject({
      protocol: 'reticulum',
      channel: null,
      dmPeer: null,
      reticulumPeerHash: 'abcd',
      reticulumSenderHash: 'abcd',
      reticulumMessageHash: 'ef01',
    });
  });

  it('resolves outbound-shaped DM peers via own-id checks', () => {
    const own = new Set([99]);
    const outboundLoRa = inboxItemToJumpTarget(
      {
        key: 'meshtastic:1',
        protocol: 'meshtastic',
        starId: '1',
        viewKey: 'dm:12',
        isDirectMessage: true,
        message: msg({ id: 1, sender_id: 99, to: 12, timestamp: 1 }),
      },
      { ownNodeIds: own },
    );
    expect(outboundLoRa.dmPeer).toBe(12);

    const outboundRet = inboxItemToJumpTarget(
      {
        key: 'reticulum:2',
        protocol: 'reticulum',
        starId: '2',
        viewKey: 'dm:x',
        isDirectMessage: true,
        message: msg({
          id: 2,
          timestamp: 2,
          reticulum_sender_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          reticulum_destination_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        }),
      },
      { ownReticulumHashes: new Set(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']) },
    );
    expect(outboundRet.reticulumPeerHash).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(outboundRet.reticulumSenderHash).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
});

describe('formatting', () => {
  const [item] = buildUnifiedInboxItems({
    enabledProtocols: ['meshcore'],
    messagesByProtocol: { ...EMPTY, meshcore: [msg({ id: 1, to: 5 })] },
  });

  it('formats a copy line', () => {
    expect(
      formatInboxItemLine(item, { protocolLabel: 'MeshCore', conversationLabel: 'DM' }, () => 'T'),
    ).toBe('[T] [MeshCore] Alpha (DM): hello');
  });

  it('builds export rows tagged with the protocol', () => {
    expect(inboxItemsToExportMessages([item], () => 'MeshCore')).toEqual([
      { timestamp: 1000, sender_name: 'Alpha [MeshCore]', payload: 'hello', channel: 0, to: 5 },
    ]);
  });

  it('uses ChatPanel-compatible star ids', () => {
    expect(messageStarId(msg({ id: 7 }))).toBe('7');
    expect(messageStarId(msg({ id: undefined, timestamp: 9, packetId: 3 }))).toBe('9-3');
    expect(inboxItemKey('meshtastic', msg({ id: undefined, timestamp: 9 }))).toBe('meshtastic:9-x');
  });
});

describe('dismissed persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips and tolerates corrupt storage', () => {
    expect(saveDismissedInboxKeys(new Set(['a:1', 'b:2']))).toBe(true);
    expect([...loadDismissedInboxKeys()]).toEqual(['a:1', 'b:2']);
    localStorage.setItem(UNIFIED_INBOX_DISMISSED_KEY, '{not json');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(loadDismissedInboxKeys().size).toBe(0);
    localStorage.setItem(UNIFIED_INBOX_DISMISSED_KEY, JSON.stringify([1, 'ok', '']));
    expect([...loadDismissedInboxKeys()]).toEqual(['ok']);
  });

  it('keeps the newest keys when over the cap', () => {
    const keys = new Set(
      Array.from({ length: UNIFIED_INBOX_DISMISSED_LIMIT + 5 }, (_, i) => `k${i}`),
    );
    saveDismissedInboxKeys(keys);
    const loaded = loadDismissedInboxKeys();
    expect(loaded.size).toBe(UNIFIED_INBOX_DISMISSED_LIMIT);
    expect(loaded.has('k0')).toBe(false);
    expect(loaded.has(`k${UNIFIED_INBOX_DISMISSED_LIMIT + 4}`)).toBe(true);
  });

  it('returns false and keeps the previous document when the write throws', () => {
    saveDismissedInboxKeys(new Set(['keep']));
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(saveDismissedInboxKeys(new Set(['new']))).toBe(false);
    vi.restoreAllMocks();
    expect([...loadDismissedInboxKeys()]).toEqual(['keep']);
  });
});

describe('isUnifiedInboxShortcut', () => {
  it.each([
    ['darwin', { metaKey: true, ctrlKey: false }, true],
    ['darwin', { metaKey: false, ctrlKey: true }, false],
    ['linux', { metaKey: false, ctrlKey: true }, true],
    ['win32', { metaKey: false, ctrlKey: true }, true],
    ['win32', { metaKey: true, ctrlKey: false }, false],
  ] as const)('%s %j → %s', (platform, mods, expected) => {
    expect(
      isUnifiedInboxShortcut({ key: 'U', shiftKey: true, altKey: false, ...mods }, platform),
    ).toBe(expected);
  });

  it('requires shift and rejects other keys', () => {
    const base = { key: 'u', metaKey: false, ctrlKey: true, altKey: false };
    expect(isUnifiedInboxShortcut({ ...base, shiftKey: false }, 'linux')).toBe(false);
    expect(isUnifiedInboxShortcut({ ...base, key: 'f', shiftKey: true }, 'linux')).toBe(false);
  });
});
