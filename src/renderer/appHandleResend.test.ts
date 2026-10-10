/**
 * Contract: App `handleResend` must match App.tsx — forward reply metadata and the prior
 * store id so retry reuses the failed bubble.
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
  const replyTo = msg.replyId != null ? String(msg.replyId) : undefined;
  sendMessage(msg.payload, msg.channel, msg.to ?? undefined, replyTo, msg.storeId);
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
});
