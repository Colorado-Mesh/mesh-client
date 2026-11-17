import { describe, expect, it } from 'vitest';

import {
  buildMeshtasticReplyParentIndex,
  findMeshtasticParentMessageForReply,
  findMeshtasticParentMessageInIndex,
  repairMeshtasticReplyPreviews,
} from './replyPreview';
import type { ChatMessage } from './types';

/** Legacy O(n²) oracle kept for parity (pre-index repair body). */
function repairMeshtasticReplyPreviewsLegacy(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (msg.replyId == null || msg.emoji != null) return msg;
    const parent = findMeshtasticParentMessageForReply(messages, msg.replyId, {
      replyPreviewSender: msg.replyPreviewSender,
      beforeTimestamp: msg.timestamp,
      channel: msg.channel,
      to: msg.to,
      excludeSenderId: msg.sender_id,
    });
    if (!parent) {
      if (msg.replyPreviewText == null && msg.replyPreviewSender == null) return msg;
      return { ...msg, replyPreviewText: undefined, replyPreviewSender: undefined };
    }
    const preview = parent.payload.length > 50 ? parent.payload.slice(0, 50) + '…' : parent.payload;
    const sender = parent.sender_name.trim() !== '' ? parent.sender_name : msg.replyPreviewSender;
    if (msg.replyPreviewText === preview && msg.replyPreviewSender === sender) return msg;
    return { ...msg, replyPreviewText: preview, replyPreviewSender: sender };
  });
}

function randomThread(seed: number, size: number): ChatMessage[] {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
  const messages: ChatMessage[] = [];
  for (let i = 0; i < size; i++) {
    const r = next();
    const isReply = i > 0 && r % 5 === 0;
    const packetId = (r % 200) + 1;
    messages.push({
      sender_id: (r % 17) + 1,
      sender_name: `N${r % 17}`,
      payload: `p${i}`,
      channel: r % 3,
      to: r % 7 === 0 ? 0 : undefined,
      timestamp: 1_700_000_000_000 + i * 1000,
      packetId,
      status: 'acked',
      ...(isReply
        ? {
            replyId: messages[next() % i].packetId ?? 1,
            replyPreviewText: r % 2 === 0 ? 'stale' : undefined,
            replyPreviewSender: r % 3 === 0 ? `N${r % 17}` : undefined,
          }
        : {}),
    });
  }
  return messages;
}

describe('Meshtastic reply parent index', () => {
  it('matches legacy scan for duplicate packet ids and filters', () => {
    const a: ChatMessage = {
      sender_id: 10,
      sender_name: 'Alice',
      payload: 'a',
      channel: 0,
      timestamp: 100,
      packetId: 42,
      status: 'acked',
    };
    const b: ChatMessage = {
      sender_id: 20,
      sender_name: 'Bob',
      payload: 'b',
      channel: 1,
      timestamp: 200,
      packetId: 42,
      status: 'acked',
    };
    const thread = [a, b];
    const index = buildMeshtasticReplyParentIndex(thread);
    const opts = {
      replyPreviewSender: 'Alice',
      beforeTimestamp: 300,
      channel: 0,
      excludeSenderId: 99,
    };
    expect(findMeshtasticParentMessageInIndex(index, 42, opts)).toBe(
      findMeshtasticParentMessageForReply(thread, 42, opts),
    );
    expect(findMeshtasticParentMessageInIndex(index, 42, { channel: 1 })).toBe(
      findMeshtasticParentMessageForReply(thread, 42, { channel: 1 }),
    );
    expect(findMeshtasticParentMessageInIndex(index, 999)).toBeUndefined();
  });

  it('repairMeshtasticReplyPreviews matches legacy oracle on random threads', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const thread = randomThread(seed, 40 + (seed % 30));
      const indexed = repairMeshtasticReplyPreviews(thread);
      const legacy = repairMeshtasticReplyPreviewsLegacy(thread);
      expect(indexed).toEqual(legacy);
    }
  });

  it('preserves object identity for rows that do not need a preview update', () => {
    const parent: ChatMessage = {
      sender_id: 1,
      sender_name: 'A',
      payload: 'hello',
      channel: 0,
      timestamp: 100,
      packetId: 7,
      status: 'acked',
    };
    const plain: ChatMessage = {
      sender_id: 2,
      sender_name: 'B',
      payload: 'plain',
      channel: 0,
      timestamp: 150,
      packetId: 8,
      status: 'acked',
    };
    const alreadyGood: ChatMessage = {
      sender_id: 3,
      sender_name: 'C',
      payload: 'reply',
      channel: 0,
      timestamp: 200,
      packetId: 9,
      replyId: 7,
      replyPreviewText: 'hello',
      replyPreviewSender: 'A',
      status: 'acked',
    };
    const out = repairMeshtasticReplyPreviews([parent, plain, alreadyGood]);
    expect(out[0]).toBe(parent);
    expect(out[1]).toBe(plain);
    expect(out[2]).toBe(alreadyGood);
  });
});
