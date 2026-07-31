/**
 * Linux Web Bluetooth device-selection session for Electron's select-bluetooth-device.
 *
 * Chromium fires the event repeatedly during discovery with a *new* callback each time.
 * Overwriting the stored callback cancels the in-flight requestDevice() with
 * "User cancelled the requestDevice() chooser." Retain the first callback and merge
 * device lists until the user selects, cancels, or the session is cleared.
 */

export interface LinuxWebBluetoothDiscoveredDevice {
  deviceId: string;
  deviceName: string;
}

export type LinuxWebBluetoothSelectCallback = (deviceId: string) => void;

export class LinuxWebBluetoothDeviceSelection {
  private pendingCallback: LinuxWebBluetoothSelectCallback | null = null;
  private readonly devices = new Map<string, LinuxWebBluetoothDiscoveredDevice>();

  hasPendingSelection(): boolean {
    return this.pendingCallback !== null;
  }

  /** Device ids allowed for resolveSelection (accumulated this session). */
  knownDeviceIds(): ReadonlySet<string> {
    return new Set(this.devices.keys());
  }

  /**
   * Start a session on the first event; on later events keep the first callback and merge devices.
   * Returns the accumulated device list for the renderer picker.
   */
  beginOrMergeDiscovery(
    deviceList: readonly { deviceId: string; deviceName?: string | null }[],
    callback: LinuxWebBluetoothSelectCallback,
  ): { isNewRequest: boolean; devices: LinuxWebBluetoothDiscoveredDevice[] } {
    const isNewRequest = this.pendingCallback === null;
    if (isNewRequest) {
      this.pendingCallback = callback;
      this.devices.clear();
    }
    for (const d of deviceList) {
      const deviceId = d.deviceId;
      if (!deviceId) continue;
      this.devices.set(deviceId, {
        deviceId,
        deviceName: d.deviceName || 'Unknown Device',
      });
    }
    return { isNewRequest, devices: Array.from(this.devices.values()) };
  }

  /**
   * Resolve with a known device id (or empty string to cancel).
   * Unknown non-empty ids are ignored (session stays open).
   * @returns true if the pending callback was invoked
   */
  resolveSelection(deviceId: string): boolean {
    if (!this.pendingCallback) return false;
    if (deviceId !== '' && !this.devices.has(deviceId)) return false;
    const cb = this.pendingCallback;
    this.clear();
    cb(deviceId);
    return true;
  }

  /** Cancel the pending requestDevice() chooser (callback with empty string). */
  cancelSelection(): boolean {
    if (!this.pendingCallback) return false;
    const cb = this.pendingCallback;
    this.clear();
    cb('');
    return true;
  }

  /**
   * Auto-cancel only if `callback` is still the retained first callback (stale-timeout guard).
   */
  cancelIfCallback(callback: LinuxWebBluetoothSelectCallback): boolean {
    if (this.pendingCallback !== callback) return false;
    return this.cancelSelection();
  }

  clear(): void {
    this.pendingCallback = null;
    this.devices.clear();
  }
}

/** Process-wide session used by main-process Web Bluetooth IPC. */
export const linuxWebBluetoothDeviceSelection = new LinuxWebBluetoothDeviceSelection();

/** Stable message for spawn ENOENT when bluetoothctl is missing (Flatpak / minimal hosts). */
export const BLUETOOTHCTL_NOT_FOUND_MESSAGE = 'bluetoothctl not found';

export function formatBluetoothctlSpawnError(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  ) {
    return BLUETOOTHCTL_NOT_FOUND_MESSAGE;
  }
  if (err instanceof Error) {
    if (/ENOENT|spawn bluetoothctl/i.test(err.message)) {
      return BLUETOOTHCTL_NOT_FOUND_MESSAGE;
    }
    return err.message;
  }
  return String(err);
}
