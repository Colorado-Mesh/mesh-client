import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/renderer/lib/types';

import { reticulumMessageMatchesDmPeer } from './reticulumChatDmFilter';

function dmMsg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, 'sender_id' | 'payload'>,
): ChatMessage {
  return {
    sender_name: 'peer',
    channel: 0,
    timestamp: Date.now(),
    ...partial,
  };
}

describe('reticulumMessageMatchesDmPeer', () => {
  const selfId = 4172361550;
  const peerId = 2838895306;
  const own = new Set([selfId]);

  it('matches outbound DM to peer with uint32-normalized ids', () => {
    const msg = dmMsg({ sender_id: selfId, to: peerId, payload: 'hello' });
    expect(reticulumMessageMatchesDmPeer(msg, peerId, own)).toBe(true);
  });

  it('matches inbound DM from peer without to field', () => {
    const msg = dmMsg({
      sender_id: peerId,
      reticulum_sender_hash: '8fd7a9361aca00000000000000000000',
      payload: 'reply',
    });
    expect(reticulumMessageMatchesDmPeer(msg, peerId, own)).toBe(true);
  });

  it('does not match unrelated channel traffic', () => {
    const msg = dmMsg({ sender_id: peerId, to: 999, payload: 'other' });
    expect(reticulumMessageMatchesDmPeer(msg, peerId, own)).toBe(false);
  });
});
