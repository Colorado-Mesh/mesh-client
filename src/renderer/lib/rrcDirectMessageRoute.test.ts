import { describe, expect, it, vi } from 'vitest';

import { rrcDmRoomKey } from '@/renderer/lib/rrcDmRoom';

import { applyRrcDirectMessageRoom } from './rrcDirectMessageRoute';

const peerA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const selfHash = 'cccccccccccccccccccccccccccccccc';
const hub = '28c7c1a68c735693aa8e6b8193ed44b2';

describe('applyRrcDirectMessageRoom', () => {
  it('opens inbound DM with focus:false and returns @hash room', () => {
    const openDm = vi.fn();
    const room = applyRrcDirectMessageRoom({
      dst_hash: selfHash,
      sender_hash: peerA,
      nickname: 'Alice',
      localIdentityHash: selfHash,
      hubDestHash: hub,
      fallbackRoom: '[hub]',
      openDm,
    });
    expect(room).toBe(rrcDmRoomKey(peerA));
    expect(openDm).toHaveBeenCalledWith({ identity_hash: peerA, nickname: 'Alice' }, hub, {
      focus: false,
    });
  });

  it('opens outbound echo DM on dst with focus:false', () => {
    const openDm = vi.fn();
    const room = applyRrcDirectMessageRoom({
      dst_hash: peerA,
      sender_hash: selfHash,
      nickname: 'Me',
      localIdentityHash: selfHash,
      hubDestHash: hub,
      fallbackRoom: '#lobby',
      openDm,
    });
    expect(room).toBe(rrcDmRoomKey(peerA));
    expect(openDm).toHaveBeenCalledWith({ identity_hash: peerA, nickname: null }, hub, {
      focus: false,
    });
  });

  it('does not openDm when local identity is unavailable', () => {
    const openDm = vi.fn();
    const room = applyRrcDirectMessageRoom({
      dst_hash: peerA,
      sender_hash: selfHash,
      nickname: 'Me',
      localIdentityHash: null,
      hubDestHash: hub,
      fallbackRoom: '[hub]',
      openDm,
    });
    expect(room).toBe('[hub]');
    expect(openDm).not.toHaveBeenCalled();
  });
});
