import { describe, expect, it, vi } from 'vitest';

import {
  BLUETOOTH_SETTINGS_URL,
  isAllowedBluetoothSettingsUrl,
  openOsBluetoothSettings,
} from './bluetoothSettings';

describe('bluetoothSettings', () => {
  it('allowlists only fixed Bluetooth settings URLs', () => {
    expect(isAllowedBluetoothSettingsUrl(BLUETOOTH_SETTINGS_URL.darwin)).toBe(true);
    expect(isAllowedBluetoothSettingsUrl(BLUETOOTH_SETTINGS_URL.win32)).toBe(true);
    expect(isAllowedBluetoothSettingsUrl('https://evil.example')).toBe(false);
  });

  it.each([
    ['darwin', BLUETOOTH_SETTINGS_URL.darwin],
    ['win32', BLUETOOTH_SETTINGS_URL.win32],
  ] as const)('opens Bluetooth settings on %s', async (platform, expectedUrl) => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    await expect(openOsBluetoothSettings({ platform, openExternal })).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith(expectedUrl);
  });

  it('no-ops on linux', async () => {
    const openExternal = vi.fn();
    await expect(openOsBluetoothSettings({ platform: 'linux', openExternal })).resolves.toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
