import { describe, expect, it } from 'vitest';

import {
  enrichMeshtasticReplyPreviews,
  findMeshtasticParentMessageForReply,
  findParentMessageForReply,
  repairMeshtasticReplyPreviews,
  REPLY_PREVIEW_MAX_LEN,
  resolveMeshtasticWireReplyId,
  truncateReplyPreviewText,
} from './replyPreview';
import type { ChatMessage } from './types';

describe('truncateReplyPreviewText', () => {
  it('truncates to REPLY_PREVIEW_MAX_LEN with ellipsis', () => {
    const s = 'a'.repeat(REPLY_PREVIEW_MAX_LEN + 10);
    expect(truncateReplyPreviewText(s).length).toBe(REPLY_PREVIEW_MAX_LEN + 1);
    expect(truncateReplyPreviewText(s).endsWith('…')).toBe(true);
  });

  it('leaves short payloads unchanged', () => {
    expect(truncateReplyPreviewText('hello')).toBe('hello');
  });
});

describe('findMeshtasticParentMessageForReply', () => {
  const wave: ChatMessage = {
    sender_id: 10,
    sender_name: 'NV0N 01',
    payload: '👋',
    channel: 0,
    timestamp: 1_780_229_868_000,
    packetId: 2_113_407_456,
    status: 'acked',
  };
  const morning: ChatMessage = {
    sender_id: 10,
    sender_name: 'NV0N 01',
    payload: 'and Good Morning!',
    channel: 0,
    timestamp: 1_780_100_000_000,
    packetId: 99_001,
    status: 'acked',
  };

  it('finds parent by packetId only (no timestamp fallback)', () => {
    expect(findMeshtasticParentMessageForReply([wave, morning], 2_113_407_456)).toBe(wave);
    expect(findMeshtasticParentMessageForReply([wave, morning], 1_780_229_868_000)).toBeUndefined();
  });

  it('disambiguates duplicate packet ids using replyPreviewSender', () => {
    const otherNodeSameId: ChatMessage = {
      sender_id: 20,
      sender_name: 'Other',
      payload: 'wrong',
      channel: 0,
      timestamp: 100,
      packetId: 42,
      status: 'acked',
    };
    const target: ChatMessage = {
      sender_id: 10,
      sender_name: 'NV0N 01',
      payload: 'target',
      channel: 0,
      timestamp: 200,
      packetId: 42,
      status: 'acked',
    };
    expect(
      findMeshtasticParentMessageForReply([otherNodeSameId, target], 42, {
        replyPreviewSender: 'NV0N 01',
      }),
    ).toBe(target);
  });

  it('does not n-1 quote when prior message timestamp hash equals next packet id', () => {
    const msg1: ChatMessage = {
      sender_id: 10,
      sender_name: 'Me',
      payload: 'one',
      channel: 0,
      timestamp: 101,
      packetId: 50,
      status: 'acked',
    };
    const msg2: ChatMessage = {
      sender_id: 10,
      sender_name: 'Me',
      payload: 'two',
      channel: 0,
      timestamp: 2_000,
      packetId: 101,
      status: 'acked',
    };
    const reply: ChatMessage = {
      sender_id: 20,
      sender_name: 'Other',
      payload: 'reply',
      channel: 0,
      timestamp: 3_000,
      packetId: 999,
      replyId: 101,
      status: 'acked',
    };
    expect(
      findMeshtasticParentMessageForReply([msg1, msg2, reply], 101, {
        beforeTimestamp: reply.timestamp,
        channel: 0,
      }),
    ).toBe(msg2);
    expect(
      findMeshtasticParentMessageForReply([msg1, reply], 101, {
        beforeTimestamp: reply.timestamp,
        channel: 0,
      }),
    ).toBeUndefined();
  });

  it('picks latest chronological match when packet ids collide across nodes', () => {
    const collision: ChatMessage = {
      sender_id: 99,
      sender_name: 'Other',
      payload: 'and Good Morning!',
      channel: 0,
      timestamp: 1_700_000_000_000,
      packetId: 2_113_407_456,
      status: 'acked',
    };
    const replyTs = 1_780_229_868_000;
    const reply: ChatMessage = {
      sender_id: 20,
      sender_name: 'KØALB HQ',
      payload: 'test',
      channel: 0,
      timestamp: replyTs + 60_000,
      packetId: 555,
      replyId: 2_113_407_456,
      status: 'acked',
    };
    expect(
      findMeshtasticParentMessageForReply([collision, wave, morning, reply], 2_113_407_456, {
        beforeTimestamp: reply.timestamp,
        channel: 0,
        replyPreviewSender: 'NV0N 01',
      }),
    ).toBe(wave);
  });
});

describe('resolveMeshtasticWireReplyId', () => {
  it('returns parent packet id when reply key matches a stored message', () => {
    const parent: ChatMessage = {
      sender_id: 1,
      sender_name: 'A',
      payload: 'hi',
      channel: 0,
      timestamp: 1_780_229_868_000,
      packetId: 2_113_407_456,
      status: 'acked',
    };
    expect(resolveMeshtasticWireReplyId([parent], 2_113_407_456)).toBe(2_113_407_456);
  });

  it('does not map timestamp keys to packet ids', () => {
    const parent: ChatMessage = {
      sender_id: 1,
      sender_name: 'A',
      payload: 'hi',
      channel: 0,
      timestamp: 1_780_229_868_000,
      packetId: 2_113_407_456,
      status: 'acked',
    };
    expect(resolveMeshtasticWireReplyId([parent], 1_780_229_868_000)).toBeUndefined();
  });
});

describe('findParentMessageForReply', () => {
  const t0 = 1_000_000;
  const parent: ChatMessage = {
    sender_id: 1,
    sender_name: 'A',
    payload: 'p',
    channel: 0,
    timestamp: t0,
    packetId: 42,
    status: 'acked',
  };

  it('finds by packetId first', () => {
    expect(findParentMessageForReply([parent], 42)).toBe(parent);
  });

  it('finds by timestamp when packetId does not match', () => {
    expect(findParentMessageForReply([parent], t0)).toBe(parent);
  });
});

describe('enrichMeshtasticReplyPreviews', () => {
  it('adds preview fields when parent exists', () => {
    const prior: ChatMessage[] = [
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'original body',
        channel: 0,
        timestamp: 100,
        packetId: 77,
        status: 'acked',
      },
    ];
    const msg: ChatMessage = {
      sender_id: 3,
      sender_name: 'Bob',
      payload: 'reply',
      channel: 0,
      timestamp: 200,
      packetId: 78,
      replyId: 77,
      status: 'acked',
    };
    const out = enrichMeshtasticReplyPreviews(msg, prior, () => 'fallback');
    expect(out.replyPreviewText).toBe('original body');
    expect(out.replyPreviewSender).toBe('Alice');
  });

  it('truncates long parent payload', () => {
    const longPayload = 'x'.repeat(REPLY_PREVIEW_MAX_LEN + 20);
    const prior: ChatMessage[] = [
      {
        sender_id: 2,
        sender_name: 'A',
        payload: longPayload,
        channel: 0,
        timestamp: 100,
        packetId: 1,
        status: 'acked',
      },
    ];
    const out = enrichMeshtasticReplyPreviews(
      {
        sender_id: 3,
        sender_name: 'B',
        payload: 'r',
        channel: 0,
        timestamp: 200,
        replyId: 1,
        status: 'acked',
      },
      prior,
      () => 'f',
    );
    expect(out.replyPreviewText?.length).toBe(REPLY_PREVIEW_MAX_LEN + 1);
    expect(out.replyPreviewText?.endsWith('…')).toBe(true);
  });
});

describe('repairMeshtasticReplyPreviews', () => {
  it('clears stale preview fields when parent cannot be resolved', () => {
    const reply: ChatMessage = {
      sender_id: 20,
      sender_name: 'Other',
      payload: 'ack to 2',
      channel: 6,
      timestamp: 3_000,
      packetId: 999,
      replyId: 101,
      replyPreviewText: 'Thanks. Ok. Reply off by 1.',
      replyPreviewSender: 'NV0N 01',
      status: 'acked',
    };
    const [repaired] = repairMeshtasticReplyPreviews([reply]);
    expect(repaired.replyPreviewText).toBeUndefined();
    expect(repaired.replyPreviewSender).toBeUndefined();
  });
});
