// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { getLocationTrust } from './locationTrust';
import { setMobileAppPlatform } from './mobilePlatform';

afterEach(() => {
  setMobileAppPlatform(null);
});

describe('getLocationTrust in the mobile app', () => {
  it('keeps desktop OS geolocation (browser source) approximate', () => {
    expect(getLocationTrust({ source: 'browser' }, null, null)).toBe('approximate');
  });

  it.each(['android', 'ios'] as const)(
    'trusts the phone GNSS fix on %s; IP stays approximate',
    (p) => {
      setMobileAppPlatform(p);
      expect(getLocationTrust({ source: 'browser' }, null, null)).toBe('trusted');
      expect(getLocationTrust({ source: 'ip' }, null, null)).toBe('approximate');
    },
  );
});
