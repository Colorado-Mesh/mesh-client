/** Fixed OS Bluetooth settings deep links — never open user-controlled URLs. */

export const BLUETOOTH_SETTINGS_URL = {
  darwin: 'x-apple.systempreferences:com.apple.BluetoothSettings',
  win32: 'ms-settings:bluetooth',
} as const;

export function isAllowedBluetoothSettingsUrl(url: string): boolean {
  return url === BLUETOOTH_SETTINGS_URL.darwin || url === BLUETOOTH_SETTINGS_URL.win32;
}

export interface OpenBluetoothSettingsDeps {
  platform: NodeJS.Platform;
  openExternal: (url: string) => Promise<void>;
}

/**
 * Open the OS Bluetooth settings pane so the user can Forget a stale bond.
 * No-op on platforms without a known deep link (e.g. linux — users use blueman/gnome-control-center).
 */
export async function openOsBluetoothSettings(deps: OpenBluetoothSettingsDeps): Promise<boolean> {
  const url =
    deps.platform === 'darwin'
      ? BLUETOOTH_SETTINGS_URL.darwin
      : deps.platform === 'win32'
        ? BLUETOOTH_SETTINGS_URL.win32
        : null;
  if (!url) return false;
  await deps.openExternal(url);
  return true;
}
