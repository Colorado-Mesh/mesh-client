import { describe, expect, it } from 'vitest';

import {
  buildMeshcoreChannelIncomingMessage,
  buildMeshcoreDmIncomingMessage,
  findMeshcoreDmReplyParent,
  meshcoreBracketDisplayNamesMatch,
  meshcoreChannelRepairRawText,
  meshcoreChatMessagesForDisplay,
  meshcorePayloadIsTapbackEmojiOnly,
  normalizeMeshcoreIncomingText,
  parseMeshcoreBracketPrefix,
  parseMeshcorePlainBracketLine,
  resolveMeshcoreBracketParentKey,
  resolveMeshcoreBracketParentKeyDm,
  resolveMeshcoreChannelMessageSender,
} from './meshcoreChannelText';
import {
  MESHCORE_UNKNOWN_SENDER_STUB_ID,
  meshcoreChatStubNodeIdFromDisplayName,
} from './meshcoreUtils';
import { REPLY_PREVIEW_MAX_LEN } from './replyPreview';
import type { ChatMessage } from './types';

describe('resolveMeshcoreChannelMessageSender', () => {
  it('does not assign the shared Unknown stub id for plain channel text', () => {
    const r = resolveMeshcoreChannelMessageSender({
      rawText: 'Morning folks! New mesh user here',
    });
    expect(r.displayName).toBe('Unknown');
    expect(r.senderId).toBe(0);
    expect(r.senderId).not.toBe(MESHCORE_UNKNOWN_SENDER_STUB_ID);
  });

  it('uses name-based stub id when wire text has DisplayName: prefix', () => {
    const r = resolveMeshcoreChannelMessageSender({
      rawText: 'Alice: hello channel',
    });
    expect(r.displayName).toBe('Alice');
    expect(r.senderId).toBe(meshcoreChatStubNodeIdFromDisplayName('Alice'));
  });

  it('prefers RF fromNodeId and advert name over Unknown fallback', () => {
    const r = resolveMeshcoreChannelMessageSender({
      rawText: 'plain body',
      rfFromNodeId: 0x12345678,
      rfAdvertName: 'RF Name',
    });
    expect(r.senderId).toBe(0x12345678);
    expect(r.displayName).toBe('RF Name');
  });
});

describe('normalizeMeshcoreIncomingText', () => {
  it('strips bracket target and preserves sender name', () => {
    expect(normalizeMeshcoreIncomingText('NVON 01: @[NVON 02] 👍')).toEqual({
      senderName: 'NVON 01',
      payload: '👍',
      bracketTargetName: 'NVON 02',
      hadBracketReplyPrefix: true,
    });
  });

  it('parses text reply body after bracket', () => {
    expect(normalizeMeshcoreIncomingText('A: @[Bob] hello there')).toEqual({
      senderName: 'A',
      payload: 'hello there',
      bracketTargetName: 'Bob',
      hadBracketReplyPrefix: true,
    });
  });

  it('does not split on colons inside r:hex tokens or times', () => {
    expect(
      normalizeMeshcoreIncomingText('what is "r:9da4:57"? Seems like my client is not rendering'),
    ).toEqual({
      payload: 'what is "r:9da4:57"? Seems like my client is not rendering',
    });
  });

  it('still parses DisplayName: body when colon is followed by space', () => {
    expect(normalizeMeshcoreIncomingText('10th mountain division: T')).toEqual({
      senderName: '10th mountain division',
      payload: 'T',
    });
  });
});

describe('parseMeshcorePlainBracketLine', () => {
  it('parses DM tapback line without Sender: prefix', () => {
    expect(parseMeshcorePlainBracketLine('@[Alice] 👍')).toEqual({
      bracketTargetName: 'Alice',
      payload: '👍',
      hadBracketReplyPrefix: true,
    });
  });

  it('returns full string as payload when no bracket', () => {
    expect(parseMeshcorePlainBracketLine('hello')).toEqual({ payload: 'hello' });
  });
});

describe('findMeshcoreDmReplyParent', () => {
  const me = 100;
  const peer = 200;
  const t0 = 5_000_000;

  it('finds parent by packetId in DM thread', () => {
    const parent: ChatMessage = {
      sender_id: peer,
      sender_name: 'Alice',
      payload: 'hi',
      channel: -1,
      timestamp: t0,
      status: 'acked',
      packetId: 4242,
      to: me,
    };
    const found = findMeshcoreDmReplyParent([parent], {
      peerNodeId: peer,
      myNodeId: me,
      replyKey: 4242,
    });
    expect(found).toBe(parent);
    expect(found?.sender_name).toBe('Alice');
  });

  it('finds parent by timestamp when packetId absent', () => {
    const parent: ChatMessage = {
      sender_id: me,
      sender_name: 'Me',
      payload: 'out',
      channel: -1,
      timestamp: t0,
      status: 'acked',
      to: peer,
    };
    const found = findMeshcoreDmReplyParent([parent], {
      peerNodeId: peer,
      myNodeId: me,
      replyKey: t0,
    });
    expect(found?.sender_name).toBe('Me');
  });

  it('skips reaction tapback rows', () => {
    const textMsg: ChatMessage = {
      sender_id: peer,
      sender_name: 'Alice',
      payload: 'yo',
      channel: -1,
      timestamp: t0,
      status: 'acked',
      packetId: 1,
      to: me,
    };
    const reaction: ChatMessage = {
      sender_id: peer,
      sender_name: 'Alice',
      payload: '👍',
      channel: -1,
      timestamp: t0 + 1,
      status: 'acked',
      packetId: 2,
      emoji: 0x1f44d,
      replyId: t0,
      to: me,
    };
    const found = findMeshcoreDmReplyParent([reaction, textMsg], {
      peerNodeId: peer,
      myNodeId: me,
      replyKey: 2,
    });
    expect(found).toBeUndefined();
  });

  it('returns undefined when replyKey is for another thread', () => {
    const other: ChatMessage = {
      sender_id: 999,
      sender_name: 'Stranger',
      payload: 'x',
      channel: -1,
      timestamp: t0,
      status: 'acked',
      packetId: 9,
      to: me,
    };
    const found = findMeshcoreDmReplyParent([other], {
      peerNodeId: peer,
      myNodeId: me,
      replyKey: 9,
    });
    expect(found).toBeUndefined();
  });
});

describe('resolveMeshcoreBracketParentKeyDm', () => {
  const me = 100;
  const peer = 200;
  const t0 = 3_000_000;
  const parents: ChatMessage[] = [
    {
      sender_id: peer,
      sender_name: 'Alice',
      payload: 'yo',
      channel: -1,
      timestamp: t0,
      status: 'acked',
      to: me,
    },
  ];

  it('resolves parent in DM thread by display name', () => {
    const key = resolveMeshcoreBracketParentKeyDm(parents, {
      peerNodeId: peer,
      myNodeId: me,
      targetName: 'Alice',
      beforeTimestamp: t0 + 500,
    });
    expect(key).toBe(t0);
  });
});

describe('buildMeshcoreDmIncomingMessage', () => {
  const me = 50;
  const peer = 60;
  const t0 = 4_000_000;
  const thread: ChatMessage[] = [
    {
      sender_id: peer,
      sender_name: 'Bob',
      payload: 'ping',
      channel: -1,
      timestamp: t0,
      status: 'acked',
      to: me,
    },
  ];

  it('builds DM reaction when plain @[Name] emoji', () => {
    const thumb = String.fromCodePoint(0x1f44d);
    const msg = buildMeshcoreDmIncomingMessage(thread, {
      rawText: `@[Bob] ${thumb}`,
      senderId: peer,
      displayName: 'Bob',
      timestamp: t0 + 100,
      receivedVia: 'rf',
      peerNodeId: peer,
      myNodeId: me,
      to: me,
    });
    expect(msg.emoji).toBe(0x1f44d);
    expect(msg.replyId).toBe(t0);
    expect(msg.payload).toBe(thumb);
    expect(msg.channel).toBe(-1);
    expect(msg.replyPreviewText).toBe('ping');
    expect(msg.replyPreviewSender).toBe('Bob');
  });
});

describe('meshcorePayloadIsTapbackEmojiOnly', () => {
  it('accepts single thumbs up', () => {
    expect(meshcorePayloadIsTapbackEmojiOnly('👍')).toBe(true);
  });

  it('rejects multi-word reply', () => {
    expect(meshcorePayloadIsTapbackEmojiOnly('hello 👍')).toBe(false);
  });
});

describe('meshcoreBracketDisplayNamesMatch', () => {
  it('matches case and surrounding whitespace', () => {
    expect(meshcoreBracketDisplayNamesMatch('  Bob ', 'bob')).toBe(true);
  });

  it('matches when one name contains the other', () => {
    expect(meshcoreBracketDisplayNamesMatch('W0STR mobl', 'W0STR')).toBe(true);
  });

  it('matches mobile alias to station name via callsign token', () => {
    expect(meshcoreBracketDisplayNamesMatch('🛩️ W0STR mobl', '🛩️ W0STR 01')).toBe(true);
    expect(meshcoreBracketDisplayNamesMatch('W0STR mobl', '🛩️ W0STR 01')).toBe(true);
  });
});

describe('resolveMeshcoreBracketParentKey', () => {
  const baseTime = 1_000_000;
  const parents: ChatMessage[] = [
    {
      sender_id: 1,
      sender_name: 'Bob',
      payload: 'orig',
      channel: 0,
      timestamp: baseTime,
      status: 'acked',
      packetId: 42,
    },
  ];

  it('resolves latest matching sender_name before timestamp', () => {
    const key = resolveMeshcoreBracketParentKey(parents, {
      channel: 0,
      targetName: 'Bob',
      beforeTimestamp: baseTime + 1000,
      to: undefined,
    });
    expect(key).toBe(42);
  });
});

describe('buildMeshcoreChannelIncomingMessage', () => {
  const baseTime = 2_000_000;
  const parents: ChatMessage[] = [
    {
      sender_id: 10,
      sender_name: 'Target',
      payload: 'parent text',
      channel: 0,
      timestamp: baseTime,
      status: 'acked',
      packetId: 99,
    },
  ];

  it('builds reaction message when bracket + single emoji', () => {
    const msg = buildMeshcoreChannelIncomingMessage(parents, {
      rawText: `Someone: @[Target] ${String.fromCodePoint(0x1f44d)}`,
      senderId: 20,
      displayName: 'Someone',
      channel: 0,
      timestamp: baseTime + 500,
      receivedVia: 'rf',
    });
    expect(msg.emoji).toBe(0x1f44d);
    expect(msg.replyId).toBe(99);
    expect(msg.payload).toBe(String.fromCodePoint(0x1f44d));
  });

  it('builds text reply with replyId', () => {
    const msg = buildMeshcoreChannelIncomingMessage(parents, {
      rawText: 'Someone: @[Target] hi back',
      senderId: 20,
      displayName: 'Someone',
      channel: 0,
      timestamp: baseTime + 500,
      receivedVia: 'rf',
    });
    expect(msg.emoji).toBeUndefined();
    expect(msg.replyId).toBe(99);
    expect(msg.payload).toBe('hi back');
    expect(msg.replyPreviewText).toBe('parent text');
    expect(msg.replyPreviewSender).toBe('Target');
  });

  it('truncates reply preview when parent payload is long', () => {
    const longParents: ChatMessage[] = [
      {
        sender_id: 10,
        sender_name: 'Target',
        payload: 'x'.repeat(REPLY_PREVIEW_MAX_LEN + 30),
        channel: 0,
        timestamp: baseTime,
        status: 'acked',
        packetId: 101,
      },
    ];
    const msg = buildMeshcoreChannelIncomingMessage(longParents, {
      rawText: 'Someone: @[Target] short',
      senderId: 20,
      displayName: 'Someone',
      channel: 0,
      timestamp: baseTime + 500,
      receivedVia: 'rf',
    });
    expect(msg.replyPreviewText?.length).toBe(REPLY_PREVIEW_MAX_LEN + 1);
    expect(msg.replyPreviewText?.endsWith('…')).toBe(true);
  });

  it('includes rxHops on channel message when provided', () => {
    const msg = buildMeshcoreChannelIncomingMessage([], {
      rawText: 'A: hi',
      senderId: 1,
      displayName: 'A',
      channel: 0,
      timestamp: 1,
      receivedVia: 'rf',
      rxHops: 2,
    });
    expect(msg.rxHops).toBe(2);
  });

  it('strips bracket prefix and sets preview sender when parent is missing', () => {
    const msg = buildMeshcoreChannelIncomingMessage([], {
      rawText: 'TB-Dek: @[W0STR mobl] agreed, coffee',
      senderId: 2,
      displayName: 'TB-Dek',
      channel: 8,
      timestamp: 3_000_000,
      receivedVia: 'rf',
    });
    expect(msg.replyId).toBeUndefined();
    expect(msg.payload).toBe('agreed, coffee');
    expect(msg.replyPreviewSender).toBe('W0STR mobl');
    expect(msg.payload).not.toMatch(/@\[/);
  });
});

describe('meshcoreChannelRepairRawText', () => {
  it('does not duplicate Sender prefix when payload already has colon form', () => {
    const raw = meshcoreChannelRepairRawText({
      sender_id: 1,
      sender_name: 'TB-Dek',
      payload: 'TB-Dek: @[W0STR mobl] agreed',
      channel: 8,
      timestamp: 1,
      status: 'acked',
    });
    expect(raw).toBe('TB-Dek: @[W0STR mobl] agreed');
  });
});

describe('parseMeshcoreBracketPrefix', () => {
  it('parses empty bracket reply @[] with body only', () => {
    expect(parseMeshcoreBracketPrefix('@[] agreed, coffee')).toEqual({
      hadBracketPrefix: true,
      targetName: undefined,
      body: 'agreed, coffee',
    });
  });
});

describe('repairMeshcoreDisplayMessages', () => {
  it('repairs stored rows that still contain @[ in payload', () => {
    const broken: ChatMessage = {
      sender_id: 2,
      sender_name: 'TB-Dek',
      payload: '@[W0STR mobl] agreed',
      channel: 8,
      timestamp: 3_000_001,
      status: 'acked',
    };
    const parent: ChatMessage = {
      sender_id: 1,
      sender_name: '🛩️ W0STR 01',
      payload: 'morning',
      channel: 8,
      timestamp: 3_000_000,
      status: 'acked',
      packetId: 77,
    };
    const out = meshcoreChatMessagesForDisplay([parent, broken]);
    expect(out[1]?.payload).toBe('agreed');
    expect(out[1]?.replyId).toBe(77);
    expect(out[1]?.replyPreviewSender).toBe('🛩️ W0STR 01');
  });

  it('repairs @[] empty bracket by inferring latest prior speaker on channel', () => {
    const parent: ChatMessage = {
      sender_id: 1,
      sender_name: '🔥 W0RMT 03',
      payload: 'morning. It is absolutely necessary this morning',
      channel: 8,
      timestamp: 3_000_000,
      status: 'acked',
      packetId: 88,
    };
    const broken: ChatMessage = {
      sender_id: 2,
      sender_name: 'TB-Dek',
      payload: '@[] agreed, a nice yirgacheffe',
      channel: 8,
      timestamp: 3_000_001,
      status: 'acked',
    };
    const out = meshcoreChatMessagesForDisplay([parent, broken]);
    expect(out[1]?.payload).toBe('agreed, a nice yirgacheffe');
    expect(out[1]?.replyId).toBe(88);
    expect(out[1]?.replyPreviewSender).toBe('🔥 W0RMT 03');
  });
});

describe('buildMeshcoreDmIncomingMessage', () => {
  it('includes rxHops when provided', () => {
    const msg = buildMeshcoreDmIncomingMessage([], {
      rawText: 'hello',
      senderId: 5,
      displayName: 'Bob',
      timestamp: 1,
      receivedVia: 'rf',
      rxHops: 0,
      peerNodeId: 5,
      myNodeId: 9,
      to: 9,
    });
    expect(msg.rxHops).toBe(0);
  });
});
