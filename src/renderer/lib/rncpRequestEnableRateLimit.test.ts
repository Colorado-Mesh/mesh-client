import { afterEach, describe, expect, it } from 'vitest';

import {
  resetRncpRequestEnableRateLimitForTests,
  tryConsumeRncpRequestEnableSlot,
} from './rncpRequestEnableRateLimit';

describe('rncpRequestEnableRateLimit', () => {
  afterEach(() => {
    resetRncpRequestEnableRateLimitForTests();
  });

  it('allows first request and rate-limits the second', () => {
    const peer = 'aabbccddeeff00112233445566778899';
    expect(tryConsumeRncpRequestEnableSlot(peer, 1_000)).toBe(true);
    expect(tryConsumeRncpRequestEnableSlot(peer, 1_001)).toBe(false);
    expect(tryConsumeRncpRequestEnableSlot(peer, 1_000 + 10 * 60 * 1000)).toBe(true);
  });

  it('rejects invalid hashes', () => {
    expect(tryConsumeRncpRequestEnableSlot('short', 1)).toBe(false);
  });
});
