/**
 * Contract: App `handleResend` must match App.tsx — forward reply metadata and, for
 * Reticulum, the prior store id so retry reuses the failed bubble.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/renderer/lib/types';

function handleResendContract(
  msg: ChatMessage,
  sendMessage: (
    text: string,
    channel: number,
    destination?: number,
    replyTo?: string,
    retryOfStoreId?: string,
  ) => void,
) {
  const replyTo =
    msg.reticulum_reply_to_hash ?? (msg.replyId != null ? String(msg.replyId) : undefined);
  const retryOfStoreId = msg.reticulum_message_hash ?? msg.storeId;
  sendMessage(msg.payload, msg.channel, msg.to ?? undefined, replyTo, retryOfStoreId);
}

describe('App handleResend (contract)', () => {
  it('forwards replyId as a string when present', () => {
    const sendMessage = vi.fn();
    const msg: ChatMessage = {
      sender_id: 1,
      sender_name: 'Me',
      payload: 'retry body',
      channel: 0,
      timestamp: 1,
      status: 'failed',
      replyId: 4242,
    };
    handleResendContract(msg, sendMessage);
    expect(sendMessage).toHaveBeenCalledWith('retry body', 0, undefined, '4242', undefined);
  });

  it('passes undefined replyId when the failed message was not a reply', () => {
    const sendMessage = vi.fn();
    const msg: ChatMessage = {
      sender_id: 1,
      sender_name: 'Me',
      payload: 'plain',
      channel: -1,
      timestamp: 1,
      status: 'failed',
      to: 0xabc,
    };
    handleResendContract(msg, sendMessage);
    expect(sendMessage).toHaveBeenCalledWith('plain', -1, 0xabc, undefined, undefined);
  });

  it('passes Reticulum message hash as retryOfStoreId so resend reuses the row', () => {
    const sendMessage = vi.fn();
    const hash = 'aa'.repeat(32);
    const msg: ChatMessage = {
      sender_id: 1,
      sender_name: 'Me',
      payload: 'lxmf retry',
      channel: 0,
      timestamp: 1,
      status: 'failed',
      to: 0x1234,
      reticulum_message_hash: hash,
      reticulum_reply_to_hash: 'bb'.repeat(32),
    };
    handleResendContract(msg, sendMessage);
    expect(sendMessage).toHaveBeenCalledWith('lxmf retry', 0, 0x1234, 'bb'.repeat(32), hash);
  });

  it('falls back to storeId when Reticulum hash is not set yet', () => {
    const sendMessage = vi.fn();
    const msg: ChatMessage = {
      sender_id: 1,
      sender_name: 'Me',
      payload: 'pending failed',
      channel: 0,
      timestamp: 1,
      status: 'failed',
      to: 0x1234,
      storeId: 'reticulum-pending-9',
    };
    handleResendContract(msg, sendMessage);
    expect(sendMessage).toHaveBeenCalledWith(
      'pending failed',
      0,
      0x1234,
      undefined,
      'reticulum-pending-9',
    );
  });
});
