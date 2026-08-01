/**
 * Linux Web Bluetooth chooser cancel IPC (awaitable invoke + fire-and-forget send).
 *
 * Extracted from index.ts so sender validation and generation handling can be
 * exercised without loading the full Electron main entrypoint.
 */

import { ipcMain } from 'electron';

import { linuxWebBluetoothDeviceSelection } from './linuxWebBluetoothDeviceSelection';
import { assertIpcSender } from './validate-ipc-sender';

/** Apply a cancel request and return the boolean result used by awaitable Connect cleanup. */
export function applyLinuxWebBluetoothCancelIpc(generation: unknown): {
  cancelled: boolean;
} {
  const result = linuxWebBluetoothDeviceSelection.applyCancel(generation);
  if (result.cancelled && result.mode === 'generation') {
    console.debug(`[IPC] bluetooth-device-cancelled: cancelled generation=${result.generation}`);
  } else if (result.cancelled && result.mode === 'force') {
    console.debug(`[IPC] bluetooth-device-cancelled: force-clear generation=${result.generation}`);
  } else if (result.mode === 'ignored') {
    const requested =
      typeof result.generation === 'number' ? ` requested=${result.generation}` : '';
    const active =
      typeof result.activeGeneration === 'number' ? ` active=${result.activeGeneration}` : '';
    console.debug(
      `[IPC] bluetooth-device-cancelled: generation mismatch or no pending — ignored${requested}${active}`,
    );
  } else {
    console.debug('[IPC] bluetooth-device-cancelled: force-clear (no pending)');
  }
  return { cancelled: result.cancelled };
}

export function registerLinuxWebBluetoothCancelIpcHandlers(): void {
  // Prefer invoke (`bluetooth-device-cancel`) before starting requestDevice() so the
  // cancel cannot race behind a new select-bluetooth-device session.
  ipcMain.handle('bluetooth-device-cancel', (event, generation: unknown) => {
    assertIpcSender(event, 'bluetooth-device-cancel');
    return applyLinuxWebBluetoothCancelIpc(generation);
  });

  // Fire-and-forget path (Cancel button / teardown). Connect must use the invoke handle.
  ipcMain.on('bluetooth-device-cancelled', (event, generation: unknown) => {
    assertIpcSender(event, 'bluetooth-device-cancelled');
    applyLinuxWebBluetoothCancelIpc(generation);
  });
}
