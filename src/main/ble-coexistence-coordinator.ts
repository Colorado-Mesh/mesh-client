import { sanitizeLogMessage } from './log-service';
import type { NobleBleManager } from './noble-ble-manager';

export type BlePeripheralOwner =
  'noble:meshtastic' | 'noble:meshcore' | 'webbt:meshtastic' | 'webbt:meshcore' | 'reticulum';

export type BleScanOwner = 'noble' | 'reticulum' | 'webbt';

export interface BleRegisteredConnection {
  mac: string;
  owner: BlePeripheralOwner;
}

export interface BleCoexistenceState {
  connections: BleRegisteredConnection[];
  scanOwner: BleScanOwner | null;
}

export class BlePeripheralConflictError extends Error {
  readonly mac: string;
  readonly existingOwner: BlePeripheralOwner;

  constructor(mac: string, existingOwner: BlePeripheralOwner) {
    super(`Bluetooth device ${mac} is already in use by ${existingOwner}`);
    this.name = 'BlePeripheralConflictError';
    this.mac = mac;
    this.existingOwner = existingOwner;
  }
}

export class BleScanBusyError extends Error {
  readonly scanOwner: BleScanOwner;

  constructor(scanOwner: BleScanOwner) {
    super(`Bluetooth scan in progress (${scanOwner})`);
    this.name = 'BleScanBusyError';
    this.scanOwner = scanOwner;
  }
}

import { normalizeBleMac } from '../shared/normalizeBleMac';

export { normalizeBleMac };

/**
 * Cooperative BLE coexistence: peripheral ownership registry + scan-only mutex.
 * Multiple stacks may hold GATT links to different devices simultaneously.
 */
export class BleCoexistenceCoordinator {
  private connections = new Map<string, BlePeripheralOwner>();
  private scanOwner: BleScanOwner | null = null;
  private nobleManager: NobleBleManager | null = null;
  private nobleScanPausedForExternal = false;

  setNobleManager(manager: NobleBleManager): void {
    this.nobleManager = manager;
  }

  getState(): BleCoexistenceState {
    return {
      connections: [...this.connections.entries()].map(([mac, owner]) => ({ mac, owner })),
      scanOwner: this.scanOwner,
    };
  }

  register(mac: string, owner: BlePeripheralOwner): void {
    const key = normalizeBleMac(mac);
    if (!key) return;
    const existing = this.connections.get(key);
    if (existing && existing !== owner) {
      throw new BlePeripheralConflictError(key, existing);
    }
    this.connections.set(key, owner);
  }

  unregister(mac: string, owner: BlePeripheralOwner): void {
    const key = normalizeBleMac(mac);
    if (!key) return;
    if (this.connections.get(key) === owner) {
      this.connections.delete(key);
    }
  }

  assertCanConnect(owner: BlePeripheralOwner, mac: string): void {
    // Reticulum holds CoreBluetooth for BLE RNode connect — Noble GATTs must wait.
    if (
      this.scanOwner === 'reticulum' &&
      (owner === 'noble:meshtastic' || owner === 'noble:meshcore')
    ) {
      throw new BleScanBusyError('reticulum');
    }
    const key = normalizeBleMac(mac);
    if (!key) return;
    const existing = this.connections.get(key);
    if (existing && existing !== owner) {
      throw new BlePeripheralConflictError(key, existing);
    }
  }

  async acquireScan(owner: BleScanOwner): Promise<void> {
    if (this.scanOwner === owner) return;
    if (this.scanOwner !== null) {
      throw new BleScanBusyError(this.scanOwner);
    }
    if (owner === 'reticulum' && this.nobleManager) {
      await this.nobleManager.pauseScanningForExternalScan();
      this.nobleScanPausedForExternal = true;
    }
    this.scanOwner = owner;
  }

  releaseScan(owner: BleScanOwner): void {
    if (this.scanOwner !== owner) return;
    this.scanOwner = null;
    if (owner === 'reticulum' && this.nobleScanPausedForExternal && this.nobleManager) {
      this.nobleScanPausedForExternal = false;
      void this.nobleManager.resumeScanningAfterExternalScan().catch((err: unknown) => {
        console.debug(
          '[BleCoexistence] resumeScanningAfterExternalScan failed (ignored):',
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
      });
    }
  }

  /** Stop Noble scan without disconnecting GATT sessions (Reticulum picker on darwin/win32). */
  async pauseNobleScan(): Promise<void> {
    await this.acquireScan('reticulum');
  }

  /**
   * Yield CoreBluetooth to the Reticulum sidecar (btleplug) for BLE RNode connect.
   * macOS cannot reliably pair/connect via btleplug while Noble holds GATT sessions.
   */
  async suspendNobleForReticulumBleConnect(): Promise<void> {
    await this.acquireScan('reticulum');
    if (this.nobleManager && (process.platform === 'darwin' || process.platform === 'win32')) {
      const disconnectMs = 30_000;
      try {
        await Promise.race([
          this.nobleManager.disconnectAllSessions(),
          new Promise<void>((_, reject) => {
            setTimeout(() => {
              reject(new Error('Noble disconnectAll timeout'));
            }, disconnectMs);
          }),
        ]);
      } catch (err) {
        console.warn(
          '[BleCoexistence] disconnectAllSessions failed or timed out (proceeding with yield):',
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }
}

export const bleCoexistenceCoordinator = new BleCoexistenceCoordinator();
