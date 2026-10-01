import { ipcMain } from 'electron';

import { BleScanBusyError } from '../ble-coexistence-coordinator';
import type { GattPairResult, GattPairStateResult, GattSidecarProxy } from '../gatt-sidecar-proxy';
import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';

const PAIRING_PIN_RE = /^\d{4,6}$/;
const MAX_PERIPHERAL_ID_LENGTH = 64;

export interface GattPairingIpcDeps {
  proxy: Pick<GattSidecarProxy, 'pairState' | 'pair' | 'unpair' | 'isRnodeBondRecoveryExclusive'>;
  /** Serialize with GATT scans/connects (`bleCoexistenceCoordinator.withScan('gatt', …)`). */
  withGattScan: <T>(operation: () => Promise<T>) => Promise<T>;
  isQuitting: () => boolean;
  platform?: () => NodeJS.Platform;
}

interface Failure {
  ok: false;
  code: string;
  error: string;
}

function failure(code: string, error: string): Failure {
  return { ok: false, code, error };
}

function validPeripheralId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PERIPHERAL_ID_LENGTH;
}

/**
 * Register Windows in-app BLE pairing IPC (`gatt:pair-state`, `gatt:pair`, `gatt:unpair`).
 * The PIN is validated here and forwarded to the sidecar; it is never logged.
 */
export function registerGattPairingIpcHandlers(deps: GattPairingIpcDeps): void {
  const platform = deps.platform ?? (() => process.platform);

  const precheck = (channel: string, peripheralId: unknown): Failure | null => {
    // OS-specific: Linux pairs via bluetoothctl (bluetooth-pair IPC) and macOS CoreBluetooth
    // shows its own pairing dialog; only WinRT needs mesh-client to drive custom pairing.
    if (platform() !== 'win32') {
      return failure('unsupported', 'in-app Bluetooth pairing is only used on Windows');
    }
    if (!validPeripheralId(peripheralId)) {
      throw new Error(`${channel}: peripheralId must be a non-empty string`);
    }
    if (deps.isQuitting()) return failure('app_quitting', 'App is quitting');
    if (deps.proxy.isRnodeBondRecoveryExclusive()) {
      return failure('rnode_bond_recovery', 'RNode bond recovery holds the Bluetooth adapter');
    }
    return null;
  };

  const run = async <T extends GattPairResult | GattPairStateResult>(
    channel: string,
    peripheralId: string,
    operation: () => Promise<T>,
  ): Promise<T | Failure> => {
    try {
      return await deps.withGattScan(operation);
    } catch (err) {
      const message = sanitizeLogMessage(err instanceof Error ? err.message : String(err));
      console.warn(
        `[main] ${channel} failed: peripheral=${sanitizeLogMessage(peripheralId)} message=${message}`,
      );
      return failure(err instanceof BleScanBusyError ? 'scan_busy' : 'internal', message);
    }
  };

  ipcMain.handle('gatt:pair-state', async (event, peripheralId: unknown) => {
    assertIpcSender(event, 'gatt:pair-state');
    const blocked = precheck('gatt:pair-state', peripheralId);
    if (blocked) return blocked;
    const id = peripheralId as string;
    return run('gatt:pair-state', id, () => deps.proxy.pairState(id));
  });

  ipcMain.handle('gatt:pair', async (event, peripheralId: unknown, pin: unknown) => {
    assertIpcSender(event, 'gatt:pair');
    const blocked = precheck('gatt:pair', peripheralId);
    if (blocked) return blocked;
    if (typeof pin !== 'string' || !PAIRING_PIN_RE.test(pin)) {
      return failure('invalid_pin', 'pairing PIN must be 4 to 6 digits');
    }
    const id = peripheralId as string;
    console.debug(`[main] gatt:pair: peripheral=${sanitizeLogMessage(id)}`);
    return run('gatt:pair', id, () => deps.proxy.pair(id, pin));
  });

  ipcMain.handle('gatt:unpair', async (event, peripheralId: unknown) => {
    assertIpcSender(event, 'gatt:unpair');
    const blocked = precheck('gatt:unpair', peripheralId);
    if (blocked) return blocked;
    const id = peripheralId as string;
    console.debug(`[main] gatt:unpair: peripheral=${sanitizeLogMessage(id)}`);
    return run('gatt:unpair', id, () => deps.proxy.unpair(id));
  });
}
