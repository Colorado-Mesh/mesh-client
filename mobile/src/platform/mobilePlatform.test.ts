// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { getMobileAppPlatform, isMobileApp, setMobileAppPlatform } from './mobilePlatform';

describe('mobilePlatform', () => {
  afterEach(() => {
    setMobileAppPlatform(null);
  });

  it('reports the desktop app when the mobile bootstrap has not run', () => {
    expect(getMobileAppPlatform()).toBeNull();
    expect(isMobileApp()).toBe(false);
  });

  it.each(['android', 'ios', 'web'] as const)('detects the %s mobile shell', (p) => {
    setMobileAppPlatform(p);
    expect(document.documentElement.getAttribute('data-mesh-mobile')).toBe(p);
    expect(getMobileAppPlatform()).toBe(p);
    expect(isMobileApp()).toBe(true);
  });

  it('ignores unknown attribute values', () => {
    document.documentElement.setAttribute('data-mesh-mobile', 'pending');
    expect(isMobileApp()).toBe(false);
  });
});
