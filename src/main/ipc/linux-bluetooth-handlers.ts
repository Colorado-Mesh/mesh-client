/**
 * Linux BLE pairing IPC via BlueZ D-Bus (no bluetoothctl).
 *
 * Flatpak grants --system-talk-name=org.bluez; pairing must not depend on a
 * host/sandbox bluetoothctl binary.
 */
import { ipcMain } from 'electron';

import {
  formatMeshtasticBluetoothPin,
  parseMeshtasticBluetoothPin,
} from '../../shared/meshtasticBluetoothPin';
import { isMacAddress, type LinuxBluezClient, linuxBluezClient } from '../linux-bluez';
import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';

export interface LinuxBluetoothIpcDeps {
  client?: LinuxBluezClient;
}

/**
 * Register Linux `bluetooth-*` IPC handlers (pair / info / unpair / scan / trust / connect).
 */
export function registerLinuxBluetoothIpcHandlers(deps: LinuxBluetoothIpcDeps = {}): void {
  const client = deps.client ?? linuxBluezClient;

  ipcMain.handle('bluetooth-unpair', async (event, macAddress: unknown) => {
    assertIpcSender(event, 'bluetooth-unpair');
    if (typeof macAddress !== 'string') {
      throw new Error('bluetooth-unpair: macAddress must be a string');
    }
    if (!isMacAddress(macAddress)) {
      throw new Error('bluetooth-unpair: invalid MAC address format');
    }
    console.debug('[IPC] bluetooth-unpair:', macAddress);
    try {
      await client.removeDevice(macAddress);
      console.debug('[IPC] bluetooth-unpair success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] bluetooth-unpair error:', sanitizeLogMessage(msg));
      throw new Error(sanitizeLogMessage(msg) || 'Failed to unpair device');
    }
  });

  ipcMain.handle('bluetooth-start-scan', async (event) => {
    assertIpcSender(event, 'bluetooth-start-scan');
    console.debug('[IPC] bluetooth-start-scan');
    try {
      await client.startDiscovery();
      console.debug('[IPC] bluetooth-start-scan success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[IPC] bluetooth-start-scan error:', sanitizeLogMessage(msg));
      throw new Error(sanitizeLogMessage(msg));
    }
  });

  ipcMain.handle('bluetooth-stop-scan', async (event) => {
    assertIpcSender(event, 'bluetooth-stop-scan');
    console.debug('[IPC] bluetooth-stop-scan');
    try {
      await client.stopDiscovery();
      console.debug('[IPC] bluetooth-stop-scan done');
    } catch (err) {
      console.warn(
        '[IPC] bluetooth-stop-scan error:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      // Don't reject — stop scan failure is not critical
    }
  });

  ipcMain.handle('bluetooth-pair', async (event, macAddress: unknown, pin: unknown) => {
    assertIpcSender(event, 'bluetooth-pair');
    if (typeof macAddress !== 'string') {
      throw new Error('bluetooth-pair: macAddress must be a string');
    }
    if (!isMacAddress(macAddress)) {
      throw new Error('bluetooth-pair: invalid MAC address format');
    }
    let normalizedPin: string | undefined;
    if (typeof pin === 'number' && Number.isInteger(pin) && pin >= 0 && pin <= 999999) {
      normalizedPin = formatMeshtasticBluetoothPin(pin);
    } else if (typeof pin === 'string' && pin.trim().length > 0) {
      const parsed = parseMeshtasticBluetoothPin(pin.trim());
      if (parsed === null) throw new Error('bluetooth-pair: pin must be exactly 6 digits');
      normalizedPin = formatMeshtasticBluetoothPin(parsed);
    } else if (typeof pin !== 'undefined' && pin !== null) {
      throw new Error('bluetooth-pair: pin must be a 6-digit number');
    }
    console.debug('[IPC] bluetooth-pair:', macAddress);
    try {
      await client.pairWithPin(macAddress, normalizedPin);
      console.debug('[IPC] bluetooth-pair success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[IPC] bluetooth-pair error:', sanitizeLogMessage(msg));
      throw new Error(sanitizeLogMessage(msg) || 'pair failed');
    }
  });

  ipcMain.handle('bluetooth-connect', async (event, macAddress: unknown) => {
    assertIpcSender(event, 'bluetooth-connect');
    if (typeof macAddress !== 'string') {
      throw new Error('bluetooth-connect: macAddress must be a string');
    }
    if (!isMacAddress(macAddress)) {
      throw new Error('bluetooth-connect: invalid MAC address format');
    }
    console.debug('[IPC] bluetooth-connect:', macAddress);
    try {
      await client.connectDevice(macAddress);
      console.debug('[IPC] bluetooth-connect success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[IPC] bluetooth-connect error:', sanitizeLogMessage(msg));
      throw new Error(sanitizeLogMessage(msg));
    }
  });

  ipcMain.handle('bluetooth-untrust', async (event, macAddress: unknown) => {
    assertIpcSender(event, 'bluetooth-untrust');
    if (typeof macAddress !== 'string') {
      throw new Error('bluetooth-untrust: macAddress must be a string');
    }
    if (!isMacAddress(macAddress)) {
      throw new Error('bluetooth-untrust: invalid MAC address format');
    }
    console.debug('[IPC] bluetooth-untrust:', macAddress);
    try {
      await client.setTrusted(macAddress, false);
      console.debug('[IPC] bluetooth-untrust done');
    } catch (err) {
      // Ignore failure — untrust is best-effort
      console.debug(
        '[IPC] bluetooth-untrust error:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
    }
  });

  ipcMain.handle('bluetooth-get-info', async (event, macAddress: unknown) => {
    assertIpcSender(event, 'bluetooth-get-info');
    if (typeof macAddress !== 'string') {
      throw new Error('bluetooth-get-info: macAddress must be a string');
    }
    if (!isMacAddress(macAddress)) {
      throw new Error('bluetooth-get-info: invalid MAC address format');
    }
    try {
      const info = await client.getDeviceInfoText(macAddress);
      return info.slice(-2000);
    } catch (err) {
      // catch-no-log-ok — get-info returns the failure text to the renderer
      const msg = err instanceof Error ? err.message : String(err);
      return sanitizeLogMessage(msg).slice(-2000);
    }
  });
}
