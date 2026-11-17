import { describe, expect, it } from 'vitest';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import type { ChatMessage } from '@/renderer/lib/types';

import {
  meshcoreRoomServerIdsFromContacts,
  repairMeshcoreChatWireTailGarbage,
  repairMeshcoreHydratedDmRfDuplicates,
  repairMeshcoreHydratedMessages,
  repairMeshcoreMisfiledRoomDmMessages,
  repairMeshcoreRoomStoredPostPayloads,
  repairMeshcoreRoomUnknownSenderNames,
} from './meshcoreDbCacheHydration';

describe('repairMeshcoreMisfiledRoomDmMessages', () => {
  it('reclassifies DM-shaped rows from room server peers', () => {
    const roomId = 0xac200e59;
    const roomIds = meshcoreRoomServerIdsFromContacts([{ node_id: roomId, contact_type: 3 }]);
    const dm: ChatMessage = {
      sender_id: roomId,
      sender_name: 'Unknown',
      payload: 'Bot Stats (24h):',
      channel: 0,
      timestamp: 1_700_000_000,
      to: 1,
    };
    const [fixed] = repairMeshcoreMisfiledRoomDmMessages([dm], roomIds);
    expect(fixed.roomServerId).toBe(roomId);
    expect(fixed.channel).toBe(MESHCORE_ROOM_MESSAGE_CHANNEL);
    expect(fixed.payload).toBe('Bot Stats (24h):');
  });
});

describe('repairMeshcoreRoomStoredPostPayloads', () => {
  it('strips garbled prefix from stored room posts on hydration', () => {
    const authorPrefix = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const garbled: ChatMessage = {
      sender_id: 0,
      sender_name: 'Unknown',
      payload: `${authorPrefix}Test from og app`,
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1_700_000_000,
      roomServerId: 0xac200e59,
      to: 0xac200e59,
    };
    const [fixed] = repairMeshcoreRoomStoredPostPayloads([garbled]);
    expect(fixed.payload).toBe('Test from og app');
  });

  it('does not strip emoji tapback room posts that look non-ASCII via surrogates', () => {
    const tapback: ChatMessage = {
      sender_id: 1429514792,
      sender_name: 'Unknown',
      payload: '@[🛜 NV0N 01] 👋',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1_700_000_000,
      roomServerId: 0xac200e59,
      to: 0xac200e59,
    };
    const [fixed] = repairMeshcoreRoomStoredPostPayloads([tapback]);
    expect(fixed.payload).toBe('@[🛜 NV0N 01] 👋');
  });

  it('repairs garbled room rows via repairMeshcoreHydratedMessages', () => {
    const authorPrefix = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const roomId = 0xac200e59;
    const garbled: ChatMessage = {
      sender_id: 0,
      sender_name: 'Unknown',
      payload: `${authorPrefix}Persisted post`,
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1_700_000_000,
      roomServerId: roomId,
      to: roomId,
    };
    const [fixed] = repairMeshcoreHydratedMessages([garbled], new Set([roomId]));
    expect(fixed.payload).toBe('Persisted post');
  });

  // Text in any script is text: only characters a decoded raw key byte leaves behind (U+FFFD,
  // control characters) mark a stored prefix. App.tsx runs this repair on every post it shows.
  it.each([
    ['an accented first letter', String.fromCodePoint(0xc9) + 'quipe ready'],
    ['Cyrillic', String.fromCodePoint(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442) + ' all'],
    ['CJK', String.fromCodePoint(0x4f60, 0x597d, 0x4e16, 0x754c, 0xff01)],
    ['a short first line', 'Hi' + String.fromCharCode(10) + 'there all'],
  ])('keeps a stored room post that starts with %s whole', (_label, payload) => {
    const roomId = 0xac200e59;
    const post: ChatMessage = {
      sender_id: 0x11,
      sender_name: 'Author',
      payload,
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1_700_000_000,
      roomServerId: roomId,
      to: roomId,
    };
    expect(repairMeshcoreHydratedMessages([post], new Set([roomId]))[0].payload).toBe(payload);
  });

  it.each([
    [
      'a UTF-8 decoded key (replacement characters)',
      String.fromCodePoint(0xfffd, 0x6c, 0xfffd, 0x49),
    ],
    ['a key with a control byte', String.fromCharCode(0x41, 0x01, 0x42, 0x43)],
  ])('still strips a stored prefix left by %s', (_label, prefix) => {
    const roomId = 0xac200e59;
    const garbled: ChatMessage = {
      sender_id: 0,
      sender_name: 'Unknown',
      payload: `${prefix}Old post`,
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1_700_000_000,
      roomServerId: roomId,
      to: roomId,
    };
    expect(repairMeshcoreHydratedMessages([garbled], new Set([roomId]))[0].payload).toBe(
      'Old post',
    );
  });
});

describe('repairMeshcoreRoomUnknownSenderNames', () => {
  it('peer-fills Unknown room sender names from other posts with the same sender_id', () => {
    const roomId = 0xac200e59;
    const selfId = 1429514792;
    const named: ChatMessage = {
      sender_id: selfId,
      sender_name: '🛜 NV0N 01',
      payload: 'testing',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1,
      roomServerId: roomId,
      to: roomId,
    };
    const unknown: ChatMessage = {
      sender_id: selfId,
      sender_name: 'Unknown',
      payload: 'Test 12:19',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 2,
      roomServerId: roomId,
      to: roomId,
    };
    const [a, b] = repairMeshcoreRoomUnknownSenderNames([named, unknown]);
    expect(a.sender_name).toBe('🛜 NV0N 01');
    expect(b.sender_name).toBe('🛜 NV0N 01');
  });

  it('fills Unknown names via repairMeshcoreHydratedMessages peer pass', () => {
    const roomId = 0xac200e59;
    const selfId = 1429514792;
    const named: ChatMessage = {
      sender_id: selfId,
      sender_name: '🛜 NV0N 01',
      payload: 'testing',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1,
      roomServerId: roomId,
      to: roomId,
    };
    const unknown: ChatMessage = {
      sender_id: selfId,
      sender_name: 'Unknown',
      payload: '@[🛜 NV0N 01] 👋',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 2,
      roomServerId: roomId,
      to: roomId,
    };
    const fixed = repairMeshcoreHydratedMessages([named, unknown], new Set([roomId]));
    expect(fixed[1]?.sender_name).toBe('🛜 NV0N 01');
    expect(fixed[1]?.payload).toBe('@[🛜 NV0N 01] 👋');
  });

  it('collapses Unknown + named room twins with the same timestamp on hydrate', () => {
    const roomId = 0x6c08b3d9;
    const selfId = 1429514792;
    const ts = 1_786_817_958_000;
    const unknown: ChatMessage = {
      sender_id: 0,
      sender_name: 'Unknown',
      payload: 'Test 12:19',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: ts,
      roomServerId: roomId,
      to: roomId,
    };
    const named: ChatMessage = {
      sender_id: selfId,
      sender_name: '🛜 NV0N 01',
      payload: 'Test 12:19',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: ts,
      roomServerId: roomId,
      to: roomId,
    };
    const fixed = repairMeshcoreHydratedMessages([unknown, named], new Set([roomId]));
    expect(fixed).toHaveLength(1);
    expect(fixed[0]?.sender_id).toBe(selfId);
    expect(fixed[0]?.sender_name).toBe('🛜 NV0N 01');
  });

  it('replaces whitespace-padded Unknown sender names from the node map', () => {
    const roomId = 0xac200e59;
    const senderId = 1429514792;
    const paddedUnknown: ChatMessage = {
      sender_id: senderId,
      sender_name: '  Unknown  ',
      payload: 'hello',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1,
      roomServerId: roomId,
      to: roomId,
    };
    const [fixed] = repairMeshcoreRoomUnknownSenderNames(
      [paddedUnknown],
      new Map([[senderId, '🛜 NV0N 01']]),
    );
    expect(fixed.sender_name).toBe('🛜 NV0N 01');
  });
});
describe('repairMeshcoreChatWireTailGarbage', () => {
  it('strips tail garbage from stored channel rows', () => {
    const tail = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const garbled: ChatMessage = {
      sender_id: 20,
      sender_name: 'LLAP 🖖 TD',
      payload: `called wadamesh\u0000${tail}`,
      channel: 0,
      timestamp: 1_700_000_000,
    };
    const [fixed] = repairMeshcoreChatWireTailGarbage([garbled]);
    expect(fixed.payload).toBe('called wadamesh');
  });

  it('repairs channel tail garbage via repairMeshcoreHydratedMessages', () => {
    const tail = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const garbled: ChatMessage = {
      sender_id: 20,
      sender_name: 'LLAP 🖖 TD',
      payload: `called wadamesh\u0000${tail}`,
      channel: 0,
      timestamp: 1_700_000_000,
    };
    const [fixed] = repairMeshcoreHydratedMessages([garbled], new Set());
    expect(fixed.payload).toBe('called wadamesh');
  });
});

describe('repairMeshcoreHydratedDmRfDuplicates', () => {
  it('drops duplicate RF DM rows loaded from SQLite', () => {
    const base: ChatMessage = {
      sender_id: 0x123,
      sender_name: 'durk',
      payload: 'N99157 3700ft',
      channel: -1,
      to: 0xabc,
      timestamp: 1_700_000_000_000,
      receivedVia: 'rf',
    };
    const dup: ChatMessage = {
      ...base,
      timestamp: base.timestamp + 52_000,
    };
    expect(repairMeshcoreHydratedDmRfDuplicates([base, dup])).toHaveLength(1);
  });
});
