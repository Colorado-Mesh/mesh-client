import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearMeshtasticLockdownStatus,
  getMeshtasticLockdownStatus,
  isMeshtasticLockdownBlocking,
  parseMeshtasticLockdownStatus,
  recordMeshtasticLockdownStatus,
  subscribeMeshtasticLockdownStatus,
} from './meshtasticLockdown';

afterEach(() => {
  clearMeshtasticLockdownStatus();
});

describe('parseMeshtasticLockdownStatus', () => {
  it('maps the state enum number to its proto name', () => {
    expect(parseMeshtasticLockdownStatus({ state: 2 })).toMatchObject({ state: 'LOCKED' });
    expect(parseMeshtasticLockdownStatus({ state: 3 })).toMatchObject({ state: 'UNLOCKED' });
    expect(parseMeshtasticLockdownStatus({ state: 1 })).toMatchObject({ state: 'NEEDS_PROVISION' });
  });

  it('keeps optional fields absent rather than zero', () => {
    const parsed = parseMeshtasticLockdownStatus({
      state: 2,
      lockReason: '   ',
      bootsRemaining: 0,
      validUntilEpoch: 0,
      backoffSeconds: 0,
    });
    expect(parsed).toMatchObject({ state: 'LOCKED' });
    expect(parsed?.lockReason).toBeUndefined();
    expect(parsed?.bootsRemaining).toBeUndefined();
    expect(parsed?.validUntilEpoch).toBeUndefined();
    expect(parsed?.backoffSeconds).toBeUndefined();
  });

  it('accepts bigint counters from the wire', () => {
    expect(
      parseMeshtasticLockdownStatus({
        state: 3,
        validUntilEpoch: 1_800_000_000,
        bootsRemaining: 5,
      }),
    ).toMatchObject({ validUntilEpoch: 1_800_000_000, bootsRemaining: 5 });
  });

  it('rejects payloads without a known state', () => {
    expect(parseMeshtasticLockdownStatus(null)).toBeNull();
    expect(parseMeshtasticLockdownStatus({})).toBeNull();
    expect(parseMeshtasticLockdownStatus({ state: 99 })).toBeNull();
  });
});

describe('lockdown status store', () => {
  it('notifies subscribers on record and clear', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeMeshtasticLockdownStatus(seen);

    recordMeshtasticLockdownStatus({ state: 2, lockReason: 'admin' });
    expect(getMeshtasticLockdownStatus()).toMatchObject({ state: 'LOCKED', lockReason: 'admin' });
    expect(seen).toHaveBeenCalledTimes(1);

    clearMeshtasticLockdownStatus();
    expect(getMeshtasticLockdownStatus()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(2);

    unsubscribe();
    recordMeshtasticLockdownStatus({ state: 3 });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('leaves state untouched for an unparseable payload', () => {
    recordMeshtasticLockdownStatus({ state: 3 });
    expect(recordMeshtasticLockdownStatus({ state: 99 })).toBeNull();
    expect(getMeshtasticLockdownStatus()).toMatchObject({ state: 'UNLOCKED' });
  });

  it('does not notify when clearing an already-empty state', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeMeshtasticLockdownStatus(seen);
    clearMeshtasticLockdownStatus();
    expect(seen).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('isMeshtasticLockdownBlocking', () => {
  it('blocks config writes only while locked or after a failed unlock', () => {
    expect(isMeshtasticLockdownBlocking(null)).toBe(false);
    expect(isMeshtasticLockdownBlocking({ state: 'LOCKED', receivedAt: 0 })).toBe(true);
    expect(isMeshtasticLockdownBlocking({ state: 'UNLOCK_FAILED', receivedAt: 0 })).toBe(true);
    expect(isMeshtasticLockdownBlocking({ state: 'UNLOCKED', receivedAt: 0 })).toBe(false);
    expect(isMeshtasticLockdownBlocking({ state: 'DISABLED', receivedAt: 0 })).toBe(false);
    expect(isMeshtasticLockdownBlocking({ state: 'NEEDS_PROVISION', receivedAt: 0 })).toBe(false);
  });
});
