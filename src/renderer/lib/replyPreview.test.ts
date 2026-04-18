import { describe, expect, it } from 'vitest';

import {
  enrichMeshtasticReplyPreviews,
  findParentMessageForReply,
  REPLY_PREVIEW_MAX_LEN,
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
