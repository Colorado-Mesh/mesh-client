import { beforeEach, describe, expect, it } from 'vitest';

import { computeReticulumMessageHash } from '@/renderer/lib/reticulum/messageHash';
import { RNCP_REQUEST_ENABLE_COOLDOWN_MS } from '@/shared/rncpRequestEnable';

import {
  resetRncpLxmfControlSideEffectDedupForTests,
  resolveRncpLxmfControlMessageHash,
  RNCP_LXMF_CONTROL_HANDLED_TTL_MS,
  tryConsumeRncpAlreadyEnabledAutoShareSlot,
  tryMarkRncpLxmfControlHandled,
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
});
