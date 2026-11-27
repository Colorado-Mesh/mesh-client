import { describe, expect, it } from 'vitest';

import { isMeshcoreLastSyncedFromRadioValue } from './meshcoreContactInput';

describe('isMeshcoreLastSyncedFromRadioValue', () => {
  it('accepts a short string, null, and undefined', () => {
    expect(isMeshcoreLastSyncedFromRadioValue('2026-11-27T00:00:00.000Z')).toBe(true);
    expect(isMeshcoreLastSyncedFromRadioValue(null)).toBe(true);
    expect(isMeshcoreLastSyncedFromRadioValue(undefined)).toBe(true);
  });

  it('rejects non-strings so they cannot clear or refresh the sync stamp', () => {
    expect(isMeshcoreLastSyncedFromRadioValue(1)).toBe(false);
    expect(isMeshcoreLastSyncedFromRadioValue({ stamp: 'x' })).toBe(false);
    expect(isMeshcoreLastSyncedFromRadioValue('x'.repeat(129))).toBe(false);
  });
});
