import { describe, expect, it } from 'vitest';

import {
  buildMeshcoreChannelIncomingMessage,
  buildMeshcoreDmIncomingMessage,
  findMeshcoreDmReplyParent,
  meshcorePayloadIsTapbackEmojiOnly,
  normalizeMeshcoreIncomingText,
  parseMeshcorePlainBracketLine,
  resolveMeshcoreBracketParentKey,
  resolveMeshcoreBracketParentKeyDm,
} from './meshcoreChannelText';
import type { ChatMessage } from './types';

describe('normalizeMeshcoreIncomingText', () => {
  it('strips bracket target and preserves sender name', () => {
    expect(normalizeMeshcoreIncomingText('NVON 01: @[NVON 02] 👍')).toEqual({
      senderName: 'NVON 01',
      payload: '👍',
      bracketTargetName: 'NVON 02',
    });
  });

  it('parses text reply body after bracket', () => {
    expect(normalizeMeshcoreIncomingText('A: @[Bob] hello there')).toEqual({
      senderName: 'A',
      payload: 'hello there',
      bracketTargetName: 'Bob',
    });
  });
});

describe('parseMeshcorePlainBracketLine', () => {
  it('parses DM tapback line without Sender: prefix', () => {
    expect(parseMeshcorePlainBracketLine('@[Alice] 👍')).toEqual({
      bracketTargetName: 'Alice',
      payload: '👍',
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
  });
});
