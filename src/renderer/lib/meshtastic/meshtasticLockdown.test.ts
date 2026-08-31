import { fromBinary } from '@bufbuild/protobuf';
import { Admin } from '@meshtastic/protobufs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearMeshtasticLockdownStatus,
  encodeMeshtasticLockdownAuth,
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
        validUntilEpoch: 1_800_000_000n,
        bootsRemaining: 5n,
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

describe('encodeMeshtasticLockdownAuth', () => {
  function decode(bytes: Uint8Array) {
    const variant = fromBinary(Admin.AdminMessageSchema, bytes).payloadVariant;
    if (variant.case !== 'lockdownAuth') throw new Error(`unexpected variant ${variant.case}`);
    return variant.value as {
      passphrase: Uint8Array;
      bootsRemaining: number;
      validUntilEpoch: bigint | number;
      lockNow: boolean;
      maxSessionSeconds: number;
      disable: boolean;
    };
  }

  it('encodes the passphrase as UTF-8 bytes', () => {
    const value = decode(encodeMeshtasticLockdownAuth({ passphrase: 'hünter2' }));

    expect(new TextDecoder().decode(value.passphrase)).toBe('hünter2');
  });

  it('defaults optional fields so the firmware sees explicit zeros', () => {
    const value = decode(encodeMeshtasticLockdownAuth({ passphrase: 'pw' }));

    expect(value.bootsRemaining).toBe(0);
    expect(Number(value.validUntilEpoch)).toBe(0);
    expect(value.lockNow).toBe(false);
    expect(value.maxSessionSeconds).toBe(0);
    expect(value.disable).toBe(false);
  });

  it('round-trips provisioning options', () => {
    const value = decode(
      encodeMeshtasticLockdownAuth({
        passphrase: 'pw',
        bootsRemaining: 3,
        validUntilEpoch: 1_800_000_000,
        lockNow: true,
        maxSessionSeconds: 900,
        disable: true,
      }),
    );

    expect(value.bootsRemaining).toBe(3);
    expect(Number(value.validUntilEpoch)).toBe(1_800_000_000);
    expect(value.lockNow).toBe(true);
    expect(value.maxSessionSeconds).toBe(900);
    expect(value.disable).toBe(true);
  });
});
