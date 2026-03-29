/**
 * Contract: App `handleResend` must pass `msg.replyId` into `device.sendMessage` so Meshtastic
 * and MeshCore retries preserve thread metadata. Keep this aligned with App.tsx handleResend.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/renderer/lib/types';

function handleResendContract(
  msg: ChatMessage,
  sendMessage: (text: string, channel: number, destination?: number, replyId?: number) => void,
) {
  sendMessage(msg.payload, msg.channel, msg.to ?? undefined, msg.replyId);
}

describe('App handleResend (contract)', () => {
  it('forwards replyId as the fourth argument when present', () => {
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
    expect(sendMessage).toHaveBeenCalledWith('retry body', 0, undefined, 4242);
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
    expect(sendMessage).toHaveBeenCalledWith('plain', -1, 0xabc, undefined);
  });
});
