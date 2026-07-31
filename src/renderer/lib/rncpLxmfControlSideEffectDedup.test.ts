import { beforeEach, describe, expect, it } from 'vitest';

import { computeReticulumMessageHash } from '@/renderer/lib/reticulum/messageHash';
import { RNCP_REQUEST_ENABLE_COOLDOWN_MS } from '@/shared/rncpRequestEnable';

import {
  commitRncpAlreadyEnabledAutoShareSlot,
  commitRncpLxmfControlHandled,
  releaseRncpAlreadyEnabledAutoShareSlot,
  releaseRncpLxmfControlHandled,
  resetRncpLxmfControlSideEffectDedupForTests,
  resolveRncpLxmfControlMessageHash,
  RNCP_LXMF_CONTROL_HANDLED_TTL_MS,
  tryConsumeRncpAlreadyEnabledAutoShareSlot,
  tryMarkRncpLxmfControlHandled,
  tryReserveRncpAlreadyEnabledAutoShareSlot,
  tryReserveRncpLxmfControlHandled,
} from './rncpLxmfControlSideEffectDedup';

describe('rncpLxmfControlSideEffectDedup', () => {
  beforeEach(() => {
    resetRncpLxmfControlSideEffectDedupForTests();
  });

  it('marks a message_hash once then rejects duplicates within TTL', () => {
    const hash = 'a'.repeat(64);
    const now = 1_000_000;
    expect(tryMarkRncpLxmfControlHandled(hash, now)).toBe(true);
    expect(tryMarkRncpLxmfControlHandled(hash, now + 1)).toBe(false);
    expect(tryMarkRncpLxmfControlHandled(hash, now + RNCP_LXMF_CONTROL_HANDLED_TTL_MS + 1)).toBe(
      true,
    );
  });

  it('rejects invalid message hashes', () => {
    expect(tryMarkRncpLxmfControlHandled('short')).toBe(false);
    expect(tryMarkRncpLxmfControlHandled('')).toBe(false);
  });

  it('resolves wire message_hash or FNV fallback', () => {
    expect(
      resolveRncpLxmfControlMessageHash({
        message_hash: 'Ab'.repeat(32),
        sender_hash: 'cd'.repeat(16),
        timestamp: 1,
        text: 'x',
      }),
    ).toBe('ab'.repeat(32));

    const sender = 'cd'.repeat(16);
    expect(
      resolveRncpLxmfControlMessageHash({
        sender_hash: sender,
        timestamp: 42,
        text: 'hello',
      }),
    ).toBe(computeReticulumMessageHash(sender, 42, 'hello'));

    expect(
      resolveRncpLxmfControlMessageHash({
        sender_hash: sender,
        text: 'hello',
      }),
    ).toBeNull();
  });

  it('rate-limits already-enabled auto-share per peer', () => {
    const peer = 'ab'.repeat(16);
    const now = 5_000_000;
    expect(tryConsumeRncpAlreadyEnabledAutoShareSlot(peer, now)).toBe(true);
    expect(tryConsumeRncpAlreadyEnabledAutoShareSlot(peer, now + 1)).toBe(false);
    expect(
      tryConsumeRncpAlreadyEnabledAutoShareSlot(peer, now + RNCP_REQUEST_ENABLE_COOLDOWN_MS),
    ).toBe(true);
  });

  it('releases a recoverable control reservation so a later attempt can proceed', () => {
    const hash = 'b'.repeat(64);
    const now = 2_000_000;
    const first = tryReserveRncpLxmfControlHandled(hash, now);
    expect(first).not.toBeNull();
    expect(tryReserveRncpLxmfControlHandled(hash, now + 1)).toBeNull();
    releaseRncpLxmfControlHandled(first!);
    const retry = tryReserveRncpLxmfControlHandled(hash, now + 2);
    expect(retry).not.toBeNull();
    commitRncpLxmfControlHandled(retry!, now + 2);
    expect(tryReserveRncpLxmfControlHandled(hash, now + 3)).toBeNull();
  });

  it('ignores release/commit for a superseded control reservation token', () => {
    const hash = 'c'.repeat(64);
    const now = 3_000_000;
    const stale = tryReserveRncpLxmfControlHandled(hash, now);
    expect(stale).not.toBeNull();
    releaseRncpLxmfControlHandled(stale!);
    const fresh = tryReserveRncpLxmfControlHandled(hash, now + 1);
    expect(fresh).not.toBeNull();
    releaseRncpLxmfControlHandled(stale!);
    expect(tryReserveRncpLxmfControlHandled(hash, now + 2)).toBeNull();
    commitRncpLxmfControlHandled(fresh!, now + 2);
    expect(tryMarkRncpLxmfControlHandled(hash, now + 3)).toBe(false);
  });

  it('releases an auto-share reservation when no share was sent', () => {
    const peer = 'cd'.repeat(16);
    const now = 6_000_000;
    const first = tryReserveRncpAlreadyEnabledAutoShareSlot(peer, now);
    expect(first).not.toBeNull();
    expect(tryReserveRncpAlreadyEnabledAutoShareSlot(peer, now + 1)).toBeNull();
    releaseRncpAlreadyEnabledAutoShareSlot(first!);
    const retry = tryReserveRncpAlreadyEnabledAutoShareSlot(peer, now + 2);
    expect(retry).not.toBeNull();
    commitRncpAlreadyEnabledAutoShareSlot(retry!, now + 2);
    expect(tryReserveRncpAlreadyEnabledAutoShareSlot(peer, now + 3)).toBeNull();
  });

  it('prunes expired peer cooldown entries and caps retained peers', () => {
    const now = 7_000_000;
    for (let i = 0; i < 520; i++) {
      const peer = i.toString(16).padStart(32, '0');
      expect(tryConsumeRncpAlreadyEnabledAutoShareSlot(peer, now + i)).toBe(true);
    }
    // Expired peer can reserve again after cooldown.
    const expiredPeer = (0).toString(16).padStart(32, '0');
    expect(
      tryConsumeRncpAlreadyEnabledAutoShareSlot(
        expiredPeer,
        now + RNCP_REQUEST_ENABLE_COOLDOWN_MS + 1,
      ),
    ).toBe(true);
    // Cap: inserting after many live entries still succeeds (oldest evicted).
    const newest = 'f'.repeat(32);
    expect(
      tryConsumeRncpAlreadyEnabledAutoShareSlot(newest, now + RNCP_REQUEST_ENABLE_COOLDOWN_MS + 2),
    ).toBe(true);
  });
});
