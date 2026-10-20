import { describe, expect, it } from 'vitest';

import { closeToTrayEnabledFromStored, resolveWindowCloseAction } from './closeToTray';

describe('closeToTrayEnabledFromStored', () => {
  it('defaults on when the key is missing', () => {
    expect(closeToTrayEnabledFromStored(null)).toBe(true);
    expect(closeToTrayEnabledFromStored(undefined)).toBe(true);
  });

  it("is on only for the stored '1' value", () => {
    expect(closeToTrayEnabledFromStored('1')).toBe(true);
    expect(closeToTrayEnabledFromStored('0')).toBe(false);
    expect(closeToTrayEnabledFromStored('true')).toBe(false);
    expect(closeToTrayEnabledFromStored('')).toBe(false);
    expect(closeToTrayEnabledFromStored('garbage')).toBe(false);
  });
});

describe('resolveWindowCloseAction', () => {
  const platforms: NodeJS.Platform[] = ['darwin', 'linux', 'win32'];

  it.each(platforms)('allows close while quitting on %s', (platform) => {
    expect(
      resolveWindowCloseAction({
        platform,
        isQuitting: true,
        hasConnection: true,
        closeToTrayEnabled: true,
        trayAvailable: true,
      }),
    ).toBe('allow');
  });

  it.each(platforms)('allows close with no connection on %s', (platform) => {
    expect(
      resolveWindowCloseAction({
        platform,
        isQuitting: false,
        hasConnection: false,
        closeToTrayEnabled: true,
        trayAvailable: true,
      }),
    ).toBe('allow');
  });

  it.each(platforms)('hides to tray when enabled and connected on %s', (platform) => {
    expect(
      resolveWindowCloseAction({
        platform,
        isQuitting: false,
        hasConnection: true,
        closeToTrayEnabled: true,
        trayAvailable: true,
      }),
    ).toBe('hide');
  });

  it('falls back to legacy behaviour when enabled but no tray is available', () => {
    expect(
      resolveWindowCloseAction({
        platform: 'darwin',
        isQuitting: false,
        hasConnection: true,
        closeToTrayEnabled: true,
        trayAvailable: false,
      }),
    ).toBe('hide');
    expect(
      resolveWindowCloseAction({
        platform: 'linux',
        isQuitting: false,
        hasConnection: true,
        closeToTrayEnabled: true,
        trayAvailable: false,
      }),
    ).toBe('minimize');
    expect(
      resolveWindowCloseAction({
        platform: 'win32',
        isQuitting: false,
        hasConnection: true,
        closeToTrayEnabled: true,
        trayAvailable: false,
      }),
    ).toBe('minimize');
  });

  it('preserves legacy fallback when the setting is off', () => {
    expect(
      resolveWindowCloseAction({
        platform: 'darwin',
        isQuitting: false,
        hasConnection: true,
        closeToTrayEnabled: false,
        trayAvailable: true,
      }),
    ).toBe('hide');
    expect(
      resolveWindowCloseAction({
        platform: 'linux',
        isQuitting: false,
        hasConnection: true,
        closeToTrayEnabled: false,
        trayAvailable: true,
      }),
    ).toBe('minimize');
    expect(
      resolveWindowCloseAction({
        platform: 'win32',
        isQuitting: false,
        hasConnection: true,
        closeToTrayEnabled: false,
        trayAvailable: true,
      }),
    ).toBe('minimize');
  });
});
