import type { GattSidecarProxy } from './gatt-sidecar-proxy';

export type BlePeripheralOwner = 'gatt:meshtastic' | 'gatt:meshcore' | 'reticulum';

export type BleScanOwner = 'gatt' | 'reticulum';

export interface BleRegisteredConnection {
  mac: string;
  owner: BlePeripheralOwner;
}

export interface BleCoexistenceState {
  connections: BleRegisteredConnection[];
  scanOwner: BleScanOwner | null;
  /** See shared BleCoexistenceState.nobleYieldDecisionPending. */
  nobleYieldDecisionPending?: boolean;
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
  /** Nested same-owner acquires (e.g. RNode yield + RSSI poll) — release only at 0. */
  private scanOwnerDepth = 0;
  /** Serializes first-time acquire across concurrent callers. */
  private scanAcquireInFlight: Promise<void> | null = null;
  /** Retained for API compat; disconnect-all yield is gone (concurrent sessions). */
  private _gattProxy: GattSidecarProxy | null = null;
  private nobleYieldDecisionPending = false;

  setGattProxy(proxy: GattSidecarProxy): void {
    this._gattProxy = proxy;
  }

  getState(): BleCoexistenceState {
    return {
      connections: [...this.connections.entries()].map(([mac, owner]) => ({ mac, owner })),
      scanOwner: this.scanOwner,
      nobleYieldDecisionPending: this.nobleYieldDecisionPending,
    };
  }

  /** Mark that a Reticulum BLE RNode yield is about to run (before status emit / RF unblock). */
  setNobleYieldDecisionPending(pending: boolean): void {
    this.nobleYieldDecisionPending = pending;
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
    // Reticulum holds CoreBluetooth for BLE RNode connect — LoRa GATTs must wait.
    if (
      this.scanOwner === 'reticulum' &&
      (owner === 'gatt:meshtastic' || owner === 'gatt:meshcore')
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
    if (this.scanAcquireInFlight) {
      await this.scanAcquireInFlight;
      return this.acquireScan(owner);
    }

    if (this.scanOwner === owner) {
      this.scanOwnerDepth += 1;
      return;
    }
    if (this.scanOwner !== null) {
      throw new BleScanBusyError(this.scanOwner);
    }

    let releaseInFlight!: () => void;
    this.scanAcquireInFlight = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    try {
      this.scanOwner = owner;
      this.scanOwnerDepth = 1;
    } finally {
      this.scanAcquireInFlight = null;
      releaseInFlight();
    }
  }

  releaseScan(owner: BleScanOwner): void {
    if (this.scanOwner !== owner) return;
    if (this.scanOwnerDepth > 1) {
      this.scanOwnerDepth -= 1;
      return;
    }
    this.scanOwnerDepth = 0;
    this.scanOwner = null;
  }

  /**
   * Legacy yield entry — no longer disconnects LoRa GATT.
   * Meshtastic/MeshCore/RNode share one sidecar btleplug adapter; MAC conflicts
   * are enforced in the sidecar registry. Kept as a no-op for API stability.
   */
  async suspendForReticulumBleConnect(): Promise<void> {
    // No-op: concurrent GATT sessions are supported in-process.
  }

  /** @deprecated Use suspendForReticulumBleConnect */
  async suspendNobleForReticulumBleConnect(): Promise<void> {
    await this.suspendForReticulumBleConnect();
  }

  /** @deprecated Scan pause is no longer required for RNode. */
  async pauseNobleScan(): Promise<void> {
    // No-op
  }
}

export const bleCoexistenceCoordinator = new BleCoexistenceCoordinator();
