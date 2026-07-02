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

/** Normalize MAC / BLE address for registry keys (case-insensitive, colon-separated). */
export function normalizeBleMac(mac: string): string {
  const trimmed = mac.trim();
  if (!trimmed) return trimmed;
  const hex = trimmed.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length === 12) {
    return hex.match(/.{1,2}/g)!.join(':');
  }
  return trimmed.toLowerCase();
}

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
    if (!this.nobleManager) return;
    await this.nobleManager.pauseScanningForExternalScan();
    this.nobleScanPausedForExternal = true;
  }
}

export const bleCoexistenceCoordinator = new BleCoexistenceCoordinator();
