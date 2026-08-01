/**
 * Linux Web Bluetooth device-selection session for Electron's select-bluetooth-device.
 *
 * Chromium fires the event repeatedly during discovery with a *new* callback each time.
 * Overwriting the stored callback cancels the in-flight requestDevice() with
 * "User cancelled the requestDevice() chooser." Retain the first callback and merge
 * device lists until the user selects, cancels, or the session is cleared.
 *
 * Each new chooser bumps `generation` so a delayed cancel from an earlier Connect
 * cannot tear down a later chooser. Stale-selection timers are owned here and cleared
 * on resolve / cancel / shutdown.
 */

export interface LinuxWebBluetoothDiscoveredDevice {
  deviceId: string;
  deviceName: string;
}

export type LinuxWebBluetoothSelectCallback = (deviceId: string) => void;

/** Result of applyCancel — used by main IPC for logging / awaitable Connect cleanup. */
export type LinuxWebBluetoothCancelResult =
  | { cancelled: true; mode: 'generation' | 'force'; generation: number }
  | {
      cancelled: false;
      mode: 'ignored' | 'force';
      generation?: number;
      activeGeneration?: number;
    };

export class LinuxWebBluetoothDeviceSelection {
  private pendingCallback: LinuxWebBluetoothSelectCallback | null = null;
  private readonly devices = new Map<string, LinuxWebBluetoothDiscoveredDevice>();
  private generation = 0;
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;

  hasPendingSelection(): boolean {
    return this.pendingCallback !== null;
  }

  /** Monotonic chooser generation; 0 means no session has started yet. */
  currentGeneration(): number {
    return this.generation;
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
  ): { isNewRequest: boolean; devices: LinuxWebBluetoothDiscoveredDevice[]; generation: number } {
    const isNewRequest = this.pendingCallback === null;
    if (isNewRequest) {
      this.clearTimer();
      this.generation += 1;
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
    return {
      isNewRequest,
      devices: Array.from(this.devices.values()),
      generation: this.generation,
    };
  }

  /**
   * Arm (or replace) the stale-selection auto-cancel timer for the current session.
   * Cleared automatically on resolve / cancel / clear.
   */
  armStaleTimeout(timeoutMs: number, onStale: () => void): void {
    this.clearTimer();
    const callback = this.pendingCallback;
    const generation = this.generation;
    if (!callback) return;
    this.selectionTimer = setTimeout(() => {
      this.selectionTimer = null;
      if (this.generation !== generation || this.pendingCallback !== callback) return;
      if (this.cancelSelection()) {
        onStale();
      }
    }, timeoutMs);
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
   * Cancel only if `generation` matches the active chooser (ignores delayed cancels).
   */
  cancelIfGeneration(generation: number): boolean {
    if (!this.pendingCallback) return false;
    if (this.generation !== generation) return false;
    return this.cancelSelection();
  }

  /**
   * Apply a renderer cancel request.
   * - Finite `generation`: cancel only that chooser (ignore stale/delayed cancels).
   * - Otherwise: force-cancel any pending session (pre-connect cleanup).
   */
  applyCancel(generation: unknown): LinuxWebBluetoothCancelResult {
    if (typeof generation === 'number' && Number.isFinite(generation)) {
      const activeGeneration = this.generation;
      if (this.cancelIfGeneration(generation)) {
        return { cancelled: true, mode: 'generation', generation };
      }
      return {
        cancelled: false,
        mode: 'ignored',
        generation,
        activeGeneration: this.pendingCallback ? activeGeneration : undefined,
      };
    }
    const activeGeneration = this.generation;
    if (this.cancelSelection()) {
      return { cancelled: true, mode: 'force', generation: activeGeneration };
    }
    return { cancelled: false, mode: 'force' };
  }

  /**
   * Auto-cancel only if `callback` is still the retained first callback (stale-timeout guard).
   */
  cancelIfCallback(callback: LinuxWebBluetoothSelectCallback): boolean {
    if (this.pendingCallback !== callback) return false;
    return this.cancelSelection();
  }

  clear(): void {
    this.clearTimer();
    this.pendingCallback = null;
    this.devices.clear();
  }

  private clearTimer(): void {
    if (this.selectionTimer) {
      clearTimeout(this.selectionTimer);
      this.selectionTimer = null;
    }
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
