import { describe, expect, it } from 'vitest';

import { getLocationTrust } from '@/renderer/lib/locationTrust';

describe('getLocationTrust (mobile override)', () => {
  it('resolves desktop imports to the mobile wrapper', () => {
    // The phone's own GNSS fix (source "browser" in the shared position model) is precise.
    expect(getLocationTrust({ source: 'browser' }, null, null)).toBe('trusted');
  });

  it('keeps IP estimates approximate and defers everything else to desktop', () => {
    expect(getLocationTrust({ source: 'ip' }, null, null)).toBe('approximate');
    expect(getLocationTrust({ source: 'device' }, null, null)).toBe('trusted');
    expect(getLocationTrust(null, null, null)).toBe('unknown');
  });
});
