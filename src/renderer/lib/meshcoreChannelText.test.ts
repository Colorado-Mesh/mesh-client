import { describe, expect, it } from 'vitest';

import {
  buildMeshcoreChannelIncomingMessage,
  meshcorePayloadIsTapbackEmojiOnly,
  normalizeMeshcoreIncomingText,
  resolveMeshcoreBracketParentKey,
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
