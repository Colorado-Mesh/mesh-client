import { describe, expect, it } from 'vitest';

import { mapMeshcoreDbRowsToChatMessages } from '../hooks/meshcore/meshcoreHookPreamble';
import {
  buildMeshcoreChannelIncomingMessage,
  buildMeshcoreDmIncomingMessage,
  buildMeshcoreOutboundSendText,
  buildMeshcoreOutboundTapbackWire,
  findMeshcoreDmReplyParent,
  formatMeshcoreWireReplyPrefix,
  formatMeshcoreWireTapbackPrefix,
  meshcoreBracketDisplayNamesMatch,
  meshcoreChannelRepairRawText,
  meshcoreChatMessagesForDisplay,
  meshcoreMessageMatchesReplyKey,
  meshcorePayloadIsTapbackEmojiOnly,
  meshcorePromoteEmojiOnlyReplyToTapback,
  meshcoreReplyBodyReferencesParent,
  normalizeMeshcoreIncomingText,
  parseMeshcoreBracketPrefix,
  parseMeshcorePlainBracketLine,
  resolveMeshcoreBracketParentKey,
  resolveMeshcoreBracketParentKeyDm,
  resolveMeshcoreChannelMessageSender,
  resolveMeshcoreOutboundWireText,
  sanitizeMeshcoreWireName,
} from './meshcoreChannelText';
import { computeMeshcoreOpenReactionHash } from './meshcoreOpenReaction';
import {
  MESHCORE_UNKNOWN_SENDER_STUB_ID,
  meshcoreChatStubNodeIdFromDisplayName,
} from './meshcoreUtils';
import { REPLY_PREVIEW_MAX_LEN } from './replyPreview';
import { chatMessageToMessageRecord, messageRecordToChatMessage } from './storeRecordAdapters';
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

  it('parses emoji-prefixed display name before bracket reply', () => {
    const r = resolveMeshcoreChannelMessageSender({
      rawText: '🆎 Alex (KØALB) Base: @[🛜 NV0N 1200] 📶',
    });
    expect(r.displayName).toBe('🆎 Alex (KØALB) Base');
    expect(r.senderId).toBe(meshcoreChatStubNodeIdFromDisplayName('🆎 Alex (KØALB) Base'));
    expect(r.payload).toBe('📶');
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
    expect(msg.replyPreviewText).toBeUndefined();
    expect(msg.replyPreviewSender).toBeUndefined();
  });

  it('builds DM reaction when keyed @[Name#replyKey] emoji (official companion wire)', () => {
    const thumb = String.fromCodePoint(0x1f44d);
    const msg = buildMeshcoreDmIncomingMessage(thread, {
      rawText: `@[Bob#${t0}] ${thumb}`,
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
    expect(msg.replyPreviewText).toBeUndefined();
  });

  it('builds DM reaction from MeshCore Open r:HASH:INDEX wire', () => {
    const hash = computeMeshcoreOpenReactionHash(Math.floor(t0 / 1000), null, 'ping');
    const msg = buildMeshcoreDmIncomingMessage(thread, {
      rawText: `r:${hash}:00`,
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
    expect(msg.payload).toBe('👍');
    expect(msg.replyPreviewText).toBe('ping');
  });
});

describe('meshcorePayloadIsTapbackEmojiOnly', () => {
  it('accepts single thumbs up', () => {
    expect(meshcorePayloadIsTapbackEmojiOnly('👍')).toBe(true);
  });

  it('rejects multi-word reply', () => {
    expect(meshcorePayloadIsTapbackEmojiOnly('hello 👍')).toBe(false);
  });

  it('rejects plain ASCII letters', () => {
    expect(meshcorePayloadIsTapbackEmojiOnly('g')).toBe(false);
    expect(meshcorePayloadIsTapbackEmojiOnly('a')).toBe(false);
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

  it('builds reaction message when keyed bracket tapback matches explicit wire reply key', () => {
    const wireReplyKey = 1_780_235_760_847;
    const msg1: ChatMessage = {
      sender_id: 10,
      sender_name: 'Target',
      payload: 'message 1',
      channel: 0,
      timestamp: baseTime,
      status: 'acked',
      packetId: wireReplyKey,
    };
    const msg2: ChatMessage = {
      sender_id: 10,
      sender_name: 'Target',
      payload: 'message 2',
      channel: 0,
      timestamp: baseTime + 100,
      status: 'acked',
      packetId: wireReplyKey + 1,
    };
    const thumb = String.fromCodePoint(0x1f44d);
    const msg = buildMeshcoreChannelIncomingMessage([msg1, msg2], {
      rawText: `Someone: @[Target#${wireReplyKey}] ${thumb}`,
      senderId: 20,
      displayName: 'Someone',
      channel: 0,
      timestamp: baseTime + 500,
      receivedVia: 'rf',
    });
    expect(msg.emoji).toBe(0x1f44d);
    expect(msg.replyId).toBe(wireReplyKey);
    expect(msg.replyPreviewText).toBeUndefined();
  });

  it('builds reaction message from MeshCore Open r:HASH:INDEX wire', () => {
    const hash = computeMeshcoreOpenReactionHash(
      Math.floor(baseTime / 1000),
      'Target',
      'parent text',
    );
    const msg = buildMeshcoreChannelIncomingMessage(parents, {
      rawText: `Someone: r:${hash}:00`,
      senderId: 20,
      displayName: 'Someone',
      channel: 0,
      timestamp: baseTime + 500,
      receivedVia: 'rf',
    });
    expect(msg.emoji).toBe(0x1f44d);
    expect(msg.replyId).toBe(99);
    expect(msg.payload).toBe('👍');
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

  it('strips firmware tail garbage from T-Deck-style channel wire text', () => {
    const tail = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const msg = buildMeshcoreChannelIncomingMessage([], {
      rawText: `LLAP 🖖 TD: called wadamesh\u0000${tail}`,
      senderId: 20,
      displayName: 'LLAP 🖖 TD',
      channel: 0,
      timestamp: baseTime + 500,
      receivedVia: 'rf',
    });
    expect(msg.payload).toBe('called wadamesh');
    expect(msg.meshcoreDedupeKey).toBe(`LLAP 🖖 TD: called wadamesh`);
  });

  it('prefers explicit wire reply key over latest-from-sender heuristic', () => {
    const wireReplyKey = 1_780_235_760_847;
    const msg1: ChatMessage = {
      sender_id: 10,
      sender_name: 'Target',
      payload: 'message 1',
      channel: 0,
      timestamp: baseTime,
      status: 'acked',
      packetId: wireReplyKey,
    };
    const msg2: ChatMessage = {
      sender_id: 10,
      sender_name: 'Target',
      payload: 'message 2',
      channel: 0,
      timestamp: baseTime + 100,
      status: 'acked',
      packetId: wireReplyKey + 1,
    };
    const msg = buildMeshcoreChannelIncomingMessage([msg1, msg2], {
      rawText: `Someone: @[Target#${wireReplyKey}] replying to first`,
      senderId: 20,
      displayName: 'Someone',
      channel: 0,
      timestamp: baseTime + 500,
      receivedVia: 'rf',
    });
    expect(msg.replyId).toBe(wireReplyKey);
    expect(msg.replyPreviewText).toBe('message 1');
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

describe('sanitizeMeshcoreWireName', () => {
  it('strips emojis for official tapback wire names', () => {
    expect(sanitizeMeshcoreWireName('🛩️ NV0N 01')).toBe('NV0N 01');
    expect(sanitizeMeshcoreWireName('NV0N 01')).toBe('NV0N 01');
  });
});

describe('buildMeshcoreOutboundTapbackWire', () => {
  it('uses keyless companion tapback wire (@[Name] emoji)', () => {
    expect(buildMeshcoreOutboundTapbackWire('NV0N 01', '🧐')).toBe('@[NV0N 01] 🧐');
  });

  it('sanitizes emojis from target name', () => {
    expect(buildMeshcoreOutboundTapbackWire('🛩️ NV0N 01', '🧐')).toBe('@[NV0N 01] 🧐');
  });

  it('uses formatMeshcoreWireTapbackPrefix for the bracket segment', () => {
    expect(buildMeshcoreOutboundTapbackWire('Bob', '👍')).toBe(
      `${formatMeshcoreWireTapbackPrefix('Bob')} 👍`,
    );
  });

  it('does not include replyKey on outbound tapback wire', () => {
    expect(buildMeshcoreOutboundTapbackWire('NV0N 01', '🧪')).not.toMatch(/#\d/);
  });
});

describe('meshcorePromoteEmojiOnlyReplyToTapback', () => {
  it('promotes replyId + single emoji payload to tapback fields', () => {
    const thumb = String.fromCodePoint(0x1f44d);
    const promoted = meshcorePromoteEmojiOnlyReplyToTapback({
      sender_id: 2,
      sender_name: 'Bob',
      payload: thumb,
      channel: 0,
      timestamp: 1000,
      replyId: 99,
      replyPreviewText: 'hello',
      replyPreviewSender: 'Alice',
    });
    expect(promoted.emoji).toBe(0x1f44d);
    expect(promoted.replyId).toBe(99);
    expect(promoted.replyPreviewText).toBeUndefined();
    expect(promoted.replyPreviewSender).toBeUndefined();
  });

  it('leaves text replies unchanged', () => {
    const msg = {
      sender_id: 2,
      sender_name: 'Bob',
      payload: 'agreed',
      channel: 0,
      timestamp: 1000,
      replyId: 99,
    };
    expect(meshcorePromoteEmojiOnlyReplyToTapback(msg)).toBe(msg);
  });
});

describe('formatMeshcoreWireReplyPrefix', () => {
  it('sanitizes display name before adding reply key', () => {
    expect(formatMeshcoreWireReplyPrefix('🛩️ NV0N 01', 1_780_235_760_847)).toBe(
      '@[NV0N 01#1780235760847]',
    );
  });
});

describe('meshcoreMessageMatchesReplyKey', () => {
  const parentMs: ChatMessage = {
    sender_id: 10,
    sender_name: 'You',
    payload: 'first message',
    channel: 25,
    timestamp: 1_780_240_708_000,
    status: 'acked',
  };

  it('matches exact ms timestamp', () => {
    expect(meshcoreMessageMatchesReplyKey(parentMs, 1_780_240_708_000)).toBe(true);
  });

  it('matches firmware Unix seconds key against stored ms timestamp', () => {
    expect(meshcoreMessageMatchesReplyKey(parentMs, 1_780_240_708)).toBe(true);
  });

  it('matches by packetId', () => {
    const withPacket: ChatMessage = { ...parentMs, packetId: 42, timestamp: 999 };
    expect(meshcoreMessageMatchesReplyKey(withPacket, 42)).toBe(true);
  });

  it('rejects unrelated keys', () => {
    expect(meshcoreMessageMatchesReplyKey(parentMs, 1_780_240_709)).toBe(false);
  });
});

describe('buildMeshcoreChannelIncomingMessage inbound reply keys', () => {
  const sender = { id: 20, name: 'Someone' };
  const you = '🛜 NV0N 01';
  const tsSec = 1_780_240_708;
  const tsMs = tsSec * 1000;

  it('quotes first message when wire key is firmware seconds', () => {
    const first: ChatMessage = {
      sender_id: 100,
      sender_name: you,
      payload: 'message one',
      channel: 6,
      timestamp: tsMs,
      status: 'acked',
    };
    const second: ChatMessage = {
      sender_id: 100,
      sender_name: you,
      payload: 'message two',
      channel: 6,
      timestamp: tsMs + 60_000,
      status: 'acked',
    };
    const msg = buildMeshcoreChannelIncomingMessage([first, second], {
      rawText: `${sender.name}: @[${you}#${tsSec}] replying to first`,
      senderId: sender.id,
      displayName: sender.name,
      channel: 6,
      timestamp: tsMs + 120_000,
      receivedVia: 'rf',
    });
    expect(msg.replyId).toBe(tsMs);
    expect(msg.replyPreviewText).toBe('message one');
  });

  it('does not fall back to latest when explicit wire key does not match', () => {
    const first: ChatMessage = {
      sender_id: 100,
      sender_name: you,
      payload: 'message one',
      channel: 6,
      timestamp: tsMs,
      status: 'acked',
    };
    const second: ChatMessage = {
      sender_id: 100,
      sender_name: you,
      payload: 'message two',
      channel: 6,
      timestamp: tsMs + 60_000,
      status: 'acked',
    };
    const msg = buildMeshcoreChannelIncomingMessage([first, second], {
      rawText: `${sender.name}: @[${you}#9999999999] unknown key reply`,
      senderId: sender.id,
      displayName: sender.name,
      channel: 6,
      timestamp: tsMs + 120_000,
      receivedVia: 'rf',
    });
    expect(msg.replyPreviewText).toBeUndefined();
    expect(msg.replyId).toBeUndefined();
    expect(msg.payload).toBe('unknown key reply');
  });
});

describe('buildMeshcoreOutboundSendText', () => {
  const parentChannel: ChatMessage = {
    sender_id: 10,
    sender_name: 'durk',
    payload: 'flight data',
    channel: 25,
    timestamp: 1_700_000_000_000,
    status: 'acked',
    packetId: 99,
  };

  it('prefixes channel reply with keyless @[Name] when parent is found', () => {
    expect(
      buildMeshcoreOutboundSendText({
        text: 'reply test',
        replyTo: '99',
        channelIndex: 25,
        myNodeNum: 7,
        messages: [parentChannel],
      }),
    ).toBe('@[durk] reply test');
  });

  it('prefixes channel reply with keyed @[Name#key] when useKeyedReplies is true', () => {
    expect(
      buildMeshcoreOutboundSendText({
        text: 'reply test',
        replyTo: '99',
        channelIndex: 25,
        myNodeNum: 7,
        messages: [parentChannel],
        useKeyedReplies: true,
      }),
    ).toBe('@[durk#99] reply test');
  });

  it('returns plain text when parent is not found', () => {
    expect(
      buildMeshcoreOutboundSendText({
        text: 'reply test',
        replyTo: '999',
        channelIndex: 25,
        myNodeNum: 7,
        messages: [parentChannel],
      }),
    ).toBe('reply test');
  });

  it('uses keyless prefix when parent has packetId', () => {
    const parent: ChatMessage = {
      ...parentChannel,
      timestamp: 1_700_000_000_001,
      packetId: 42,
    };
    expect(
      buildMeshcoreOutboundSendText({
        text: 'hi',
        replyTo: '42',
        channelIndex: 25,
        myNodeNum: 7,
        messages: [parent],
      }),
    ).toBe('@[durk] hi');
  });

  it('prefixes DM reply when parent is in thread', () => {
    const myNode = 7;
    const peer = 0x22;
    const parent: ChatMessage = {
      sender_id: peer,
      sender_name: 'Alice',
      payload: 'parent line',
      channel: -1,
      timestamp: 1_700_000_000_000,
      status: 'acked',
      packetId: 77_777,
      to: myNode,
    };
    expect(
      buildMeshcoreOutboundSendText({
        text: 'hi',
        replyTo: '77777',
        channelIndex: 0,
        destination: peer,
        myNodeNum: myNode,
        messages: [parent],
      }),
    ).toBe('@[Alice] hi');
  });

  it('returns plain text when replyTo is absent', () => {
    expect(
      buildMeshcoreOutboundSendText({
        text: 'hello',
        channelIndex: 0,
        myNodeNum: 7,
        messages: [],
      }),
    ).toBe('hello');
  });

  it('uses keyless official companion wire for stub display names', () => {
    const parent: ChatMessage = {
      sender_id: 10,
      sender_name: '!5534aa28',
      payload: 'original',
      channel: 6,
      timestamp: 1_782_006_950_000,
      status: 'acked',
    };
    expect(
      buildMeshcoreOutboundSendText({
        text: 'still sending the timestamp keys',
        replyTo: String(1_782_006_950_000),
        channelIndex: 6,
        myNodeNum: 7,
        messages: [parent],
      }),
    ).toBe('@[!5534aa28] still sending the timestamp keys');
  });
});

describe('resolveMeshcoreOutboundWireText', () => {
  it('normalizes Giphy URL to g: wire when openWireCompat is enabled', () => {
    expect(
      resolveMeshcoreOutboundWireText({
        text: 'https://giphy.com/gifs/funny-a5viI92PAF89q',
        channelIndex: 0,
        myNodeNum: 7,
        messages: [],
        openWireCompat: true,
      }),
    ).toEqual({ wireText: 'g:a5viI92PAF89q', displayPayload: 'g:a5viI92PAF89q' });
  });

  it('does not normalize GIF wire when openWireCompat is disabled', () => {
    expect(
      resolveMeshcoreOutboundWireText({
        text: 'g:a5viI92PAF89q',
        channelIndex: 0,
        myNodeNum: 7,
        messages: [],
        openWireCompat: false,
      }),
    ).toEqual({ wireText: 'g:a5viI92PAF89q', displayPayload: 'g:a5viI92PAF89q' });
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

  it('parses mesh-client wire reply key suffix after #', () => {
    expect(parseMeshcoreBracketPrefix('@[NV0N 01#1780235760847] thanks')).toEqual({
      hadBracketPrefix: true,
      targetName: 'NV0N 01',
      wireReplyKey: 1780235760847,
      body: 'thanks',
    });
  });

  it('does not treat display name User#1234 as a wire reply key', () => {
    expect(parseMeshcoreBracketPrefix('@[User#1234] hello')).toEqual({
      hadBracketPrefix: true,
      targetName: 'User#1234',
      body: 'hello',
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

  it('promotes emoji-only reply rows to tapbacks after repair', () => {
    const parent: ChatMessage = {
      sender_id: 1,
      sender_name: 'Alice',
      payload: 'hello',
      channel: 0,
      timestamp: 1_000,
      status: 'acked',
      packetId: 1_780_235_760_847,
    };
    const thumb = String.fromCodePoint(0x1f44d);
    const emojiReply: ChatMessage = {
      sender_id: 2,
      sender_name: 'Bob',
      payload: thumb,
      channel: 0,
      timestamp: 2_000,
      status: 'acked',
      replyId: 1_780_235_760_847,
      replyPreviewText: 'hello',
      replyPreviewSender: 'Alice',
    };
    const out = meshcoreChatMessagesForDisplay([parent, emojiReply]);
    expect(out[1]?.emoji).toBe(0x1f44d);
    expect(out[1]?.replyId).toBe(1_780_235_760_847);
    expect(out[1]?.replyPreviewText).toBeUndefined();
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

  it('does not overwrite explicit replyId when newer messages from the same sender exist', () => {
    const msg1: ChatMessage = {
      sender_id: 100,
      sender_name: 'NV0N',
      payload: 'message 1',
      channel: 6,
      timestamp: 1_000,
      status: 'acked',
      packetId: 1001,
    };
    const msg2: ChatMessage = {
      sender_id: 100,
      sender_name: 'NV0N',
      payload: 'message 2',
      channel: 6,
      timestamp: 2_000,
      status: 'acked',
      packetId: 1002,
    };
    const msg3: ChatMessage = {
      sender_id: 100,
      sender_name: 'NV0N',
      payload: 'message 3',
      channel: 6,
      timestamp: 3_000,
      status: 'acked',
      packetId: 1003,
    };
    const outboundReply: ChatMessage = {
      sender_id: 100,
      sender_name: 'NV0N',
      payload: 'test reply to message 2',
      channel: 6,
      timestamp: 4_000,
      status: 'acked',
      replyId: 1002,
      replyPreviewText: 'message 2',
      replyPreviewSender: 'NV0N',
    };
    const out = meshcoreChatMessagesForDisplay([msg1, msg2, msg3, outboundReply]);
    expect(out[3]?.replyId).toBe(1002);
    expect(out[3]?.replyPreviewText).toBe('message 2');
  });

  it('repairs stale incoming bracket reply when parent message arrived after first ingest', () => {
    const oldMsg: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'oh man, still off... just one though. Thanks',
      channel: 6,
      timestamp: 1_789_000,
      status: 'acked',
    };
    const message6: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Message 6 - someone please reply to this.',
      channel: 6,
      timestamp: 1_826_000,
      status: 'acked',
    };
    const staleIncoming: ChatMessage = {
      sender_id: 200,
      sender_name: 'BC02',
      payload: 'reply to message 6',
      channel: 6,
      timestamp: 1_829_000,
      status: 'acked',
      replyId: 1_789_000,
      replyPreviewText: 'oh man, still off... just one though. Thanks',
      replyPreviewSender: '🛜 NV0N 01',
    };
    const out = meshcoreChatMessagesForDisplay([oldMsg, message6, staleIncoming]);
    expect(out[2]?.replyId).toBe(1_826_000);
    expect(out[2]?.replyPreviewText).toContain('Message 6');
  });

  it('matches Alex-style quoted parent text from reply payload (DB repro)', () => {
    const thankYou: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'thank you',
      channel: 6,
      timestamp: 1780238318795,
      status: 'acked',
    };
    const message7: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'oh we have a 6 so that was 7.  Please reply to this one',
      channel: 6,
      timestamp: 1780238482088,
      status: 'acked',
    };
    const alex: ChatMessage = {
      sender_id: 200,
      sender_name: '🆎 Alex KØALB',
      payload: 'reply to "oh we have a 6 so that was 7.  Please reply to this one"',
      channel: 6,
      timestamp: 1780238999000,
      status: 'acked',
      replyId: 1780238318795,
      replyPreviewText: 'thank you',
      replyPreviewSender: '🛜 NV0N 01',
    };
    const out = meshcoreChatMessagesForDisplay([thankYou, message7, alex]);
    expect(out[2]?.replyId).toBe(1780238482088);
    expect(out[2]?.replyPreviewText).toContain('oh we have a 6');
  });

  it('matches Wherewolf reply to 7 via short numeric hint', () => {
    const thankYou: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'thank you',
      channel: 6,
      timestamp: 1780238318795,
      status: 'acked',
    };
    const message7: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'oh we have a 6 so that was 7.  Please reply to this one',
      channel: 6,
      timestamp: 1780238482088,
      status: 'acked',
    };
    const wherewolf: ChatMessage = {
      sender_id: 300,
      sender_name: '🫈Wherewolf Mane',
      payload: 'reply to 7',
      channel: 6,
      timestamp: 1780239022000,
      status: 'acked',
      replyId: 1780238318795,
      replyPreviewText: 'thank you',
      replyPreviewSender: '🛜 NV0N 01',
    };
    const out = meshcoreChatMessagesForDisplay([thankYou, message7, wherewolf]);
    expect(out[2]?.replyId).toBe(1780238482088);
    expect(out[2]?.replyPreviewText).toContain('was 7');
  });

  it('repairs StackCore reply to A against stale Thank you parent (DB repro)', () => {
    const thankYou: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Thank you',
      channel: 6,
      timestamp: 1780239056187,
      status: 'acked',
    };
    const messageA: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Message A - please reply to this. The history of replies is looking good now so 🤞',
      channel: 6,
      timestamp: 1780239277301,
      status: 'acked',
    };
    const stackcore: ChatMessage = {
      sender_id: 201,
      sender_name: '⛷️ StackCore',
      payload: 'reply to A',
      channel: 6,
      timestamp: 1780239611000,
      status: 'acked',
      replyId: 1780239056187,
      replyPreviewText: 'Thank you',
      replyPreviewSender: '🛜 NV0N 01',
    };
    const out = meshcoreChatMessagesForDisplay([thankYou, messageA, stackcore]);
    expect(out[2]?.replyId).toBe(1780239277301);
    expect(out[2]?.replyPreviewText).toContain('Message A');
  });

  it('repairs Packman to A against stale Thank you parent (DB repro)', () => {
    const thankYou: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Thank you',
      channel: 6,
      timestamp: 1780239056187,
      status: 'acked',
    };
    const messageA: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Message A - please reply to this.',
      channel: 6,
      timestamp: 1780239277301,
      status: 'acked',
    };
    const packman: ChatMessage = {
      sender_id: 202,
      sender_name: 'Packman Home',
      payload: 'to A',
      channel: 6,
      timestamp: 1780239722000,
      status: 'acked',
      replyId: 1780239056187,
      replyPreviewText: 'Thank you',
      replyPreviewSender: '🛜 NV0N 01',
    };
    const out = meshcoreChatMessagesForDisplay([thankYou, messageA, packman]);
    expect(out[2]?.replyId).toBe(1780239277301);
    expect(out[2]?.replyPreviewText).toContain('Message A');
  });

  it('repairs Wherewolf reply to b against stale Thank you. parent (DB repro)', () => {
    const thankYou: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Thank you.',
      channel: 6,
      timestamp: 1780239830519,
      status: 'acked',
    };
    const messageB: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload:
        'Message B - reply to this please. 🙏  Looks like the fix I put in was only running on database hydration and not live replies.',
      channel: 6,
      timestamp: 1780240608140,
      status: 'acked',
    };
    const wherewolf: ChatMessage = {
      sender_id: 203,
      sender_name: '🫈Wherewolf Mane',
      payload: 'reply to b',
      channel: 6,
      timestamp: 1780240702000,
      status: 'acked',
      replyId: 1780239830519,
      replyPreviewText: 'Thank you.',
      replyPreviewSender: '🛜 NV0N 01',
    };
    const out = meshcoreChatMessagesForDisplay([thankYou, messageB, wherewolf]);
    expect(out[2]?.replyId).toBe(1780240608140);
    expect(out[2]?.replyPreviewText).toContain('Message B');
  });

  it('overrides wrong explicit @[Name#key] when body says reply to b', () => {
    const thankYou: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Thank you.',
      channel: 6,
      timestamp: 1780239830519,
      status: 'acked',
    };
    const messageB: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Message B - reply to this please.',
      channel: 6,
      timestamp: 1780240608140,
      status: 'acked',
    };
    const wherewolf: ChatMessage = {
      sender_id: 203,
      sender_name: '🫈Wherewolf Mane',
      payload: 'reply to b',
      channel: 6,
      timestamp: 1780240702000,
      status: 'acked',
      replyId: 1780239830519,
      replyPreviewText: 'Thank you.',
      replyPreviewSender: '🛜 NV0N 01',
      meshcoreDedupeKey: `🫈Wherewolf Mane: @[🛜 NV0N 01#1780239830519] reply to b`,
    };
    const out = meshcoreChatMessagesForDisplay([thankYou, messageB, wherewolf]);
    expect(out[2]?.replyId).toBe(1780240608140);
    expect(out[2]?.replyPreviewText).toContain('Message B');
  });

  it('overrides stale explicit @[Name#key] when body is generic (sounds good)', () => {
    const thankYou: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Thank you.',
      channel: 6,
      timestamp: 1780239830519,
      status: 'acked',
    };
    const messageB: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Message B - reply to this please.',
      channel: 6,
      timestamp: 1780240608140,
      status: 'acked',
    };
    const reply: ChatMessage = {
      sender_id: 203,
      sender_name: '🫈Wherewolf Mane',
      payload: 'sounds good',
      channel: 6,
      timestamp: 1780240702000,
      status: 'acked',
      replyId: 1780239830519,
      replyPreviewText: 'Thank you.',
      replyPreviewSender: '🛜 NV0N 01',
      meshcoreDedupeKey: `🫈Wherewolf Mane: @[🛜 NV0N 01#1780239830519] sounds good`,
    };
    const out = meshcoreChatMessagesForDisplay([thankYou, messageB, reply]);
    expect(out[2]?.replyId).toBe(1780240608140);
    expect(out[2]?.replyPreviewText).toContain('Message B');
  });

  it('keeps stale explicit @[Name#key] when body references the keyed parent', () => {
    const thankYou: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Thank you.',
      channel: 6,
      timestamp: 1780239830519,
      status: 'acked',
    };
    const messageB: ChatMessage = {
      sender_id: 100,
      sender_name: '🛜 NV0N 01',
      payload: 'Message B - reply to this please.',
      channel: 6,
      timestamp: 1780240608140,
      status: 'acked',
    };
    const reply: ChatMessage = {
      sender_id: 203,
      sender_name: '🫈Wherewolf Mane',
      payload: 'about your thank you note — still thinking',
      channel: 6,
      timestamp: 1780240702000,
      status: 'acked',
      replyId: 1780239830519,
      replyPreviewText: 'Thank you.',
      replyPreviewSender: '🛜 NV0N 01',
      meshcoreDedupeKey: `🫈Wherewolf Mane: @[🛜 NV0N 01#1780239830519] about your thank you note — still thinking`,
    };
    const out = meshcoreChatMessagesForDisplay([thankYou, messageB, reply]);
    expect(out[2]?.replyId).toBe(1780239830519);
    expect(out[2]?.replyPreviewText).toContain('Thank you');
  });
});

describe('meshcoreReplyBodyReferencesParent', () => {
  it('returns false for generic short replies', () => {
    expect(meshcoreReplyBodyReferencesParent('sounds good', 'Thank you.')).toBe(false);
    expect(meshcoreReplyBodyReferencesParent('agreed', 'Message B - reply to this please.')).toBe(
      false,
    );
  });

  it('returns true when body quotes parent text', () => {
    expect(meshcoreReplyBodyReferencesParent('about your thank you note', 'Thank you.')).toBe(true);
  });
});

describe('mapMeshcoreDbRowsToChatMessages reply repair', () => {
  it('repairs Wherewolf reply to b from DB rows (live ingest stale reply_id)', () => {
    const rows = [
      {
        id: 1986,
        sender_id: 100,
        sender_name: '🛜 NV0N 01',
        payload: 'Thank you.',
        channel_idx: 6,
        timestamp: 1780239830519,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: null,
        to_node: null,
        received_via: 'rf',
        rx_packet_fingerprint: null,
        reply_preview_text: null,
        reply_preview_sender: null,
        rx_hops: null,
      },
      {
        id: 1988,
        sender_id: 100,
        sender_name: '🛜 NV0N 01',
        payload:
          'Message B - reply to this please. 🙏  Looks like the fix I put in was only running on database hydration and not live replies.',
        channel_idx: 6,
        timestamp: 1780240608140,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: null,
        to_node: null,
        received_via: 'rf',
        rx_packet_fingerprint: null,
        reply_preview_text: null,
        reply_preview_sender: null,
        rx_hops: null,
      },
      {
        id: 1989,
        sender_id: 203,
        sender_name: '🫈Wherewolf Mane',
        payload: 'reply to b',
        channel_idx: 6,
        timestamp: 1780240702000,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: 1780239830519,
        to_node: null,
        received_via: 'mqtt',
        rx_packet_fingerprint: null,
        reply_preview_text: 'Thank you.',
        reply_preview_sender: '🛜 NV0N 01',
        rx_hops: null,
      },
    ];
    const mapped = mapMeshcoreDbRowsToChatMessages(rows);
    const wherewolf = mapped.find((m) => m.payload === 'reply to b');
    expect(wherewolf?.replyId).toBe(1780240608140);
    expect(wherewolf?.replyPreviewText).toContain('Message B');
  });

  it('keeps Wherewolf reply repair through store record round-trip', () => {
    const rows = [
      {
        id: 1988,
        sender_id: 100,
        sender_name: '🛜 NV0N 01',
        payload: 'Message B - reply to this please.',
        channel_idx: 6,
        timestamp: 1780240608140,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: null,
        to_node: null,
        received_via: 'rf',
        rx_packet_fingerprint: null,
        reply_preview_text: null,
        reply_preview_sender: null,
        rx_hops: null,
      },
      {
        id: 1989,
        sender_id: 203,
        sender_name: '🫈Wherewolf Mane',
        payload: 'reply to b',
        channel_idx: 6,
        timestamp: 1780240702000,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: 1780239830519,
        to_node: null,
        received_via: 'mqtt',
        rx_packet_fingerprint: null,
        reply_preview_text: 'Thank you.',
        reply_preview_sender: '🛜 NV0N 01',
        rx_hops: null,
      },
    ];
    const mapped = mapMeshcoreDbRowsToChatMessages(rows);
    const records = mapped.map((m) => chatMessageToMessageRecord(m));
    const roundTripped = meshcoreChatMessagesForDisplay(
      records.map((r) => messageRecordToChatMessage(r)),
    );
    const wherewolf = roundTripped.find((m) => m.payload === 'reply to b');
    expect(wherewolf?.replyId).toBe(1780240608140);
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
