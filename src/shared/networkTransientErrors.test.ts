// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isTransientNetworkError,
  isTransientNetworkErrorCode,
  TRANSIENT_NETWORK_ERROR_CODES,
} from './networkTransientErrors';

describe('networkTransientErrors', () => {
  it('includes interface-down codes used during sleep/wake', () => {
    expect(TRANSIENT_NETWORK_ERROR_CODES.has('ENETDOWN')).toBe(true);
    expect(TRANSIENT_NETWORK_ERROR_CODES.has('ENETUNREACH')).toBe(true);
    expect(TRANSIENT_NETWORK_ERROR_CODES.has('EHOSTUNREACH')).toBe(true);
  });

  it('isTransientNetworkErrorCode matches known codes', () => {
    expect(isTransientNetworkErrorCode('ENETDOWN')).toBe(true);
    expect(isTransientNetworkErrorCode('EHOSTUNREACH')).toBe(true);
    expect(isTransientNetworkErrorCode('EPERM')).toBe(false);
  });

  it('isTransientNetworkError treats ENETDOWN and keepalive timeouts as transient', () => {
    expect(
      isTransientNetworkError(Object.assign(new Error('read ENETDOWN'), { code: 'ENETDOWN' })),
    ).toBe(true);
    expect(isTransientNetworkError(new Error('Keepalive timeout'))).toBe(true);
    expect(isTransientNetworkError(new Error('connack timeout'))).toBe(true);
    expect(
      isTransientNetworkError(Object.assign(new Error('auth failed'), { code: 'EPERM' })),
    ).toBe(false);
  });
});
