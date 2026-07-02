import type { NobleBleManager } from './noble-ble-manager';

export type BleAdapterOwner = 'noble' | 'reticulum-sidecar';

export interface BleAdapterState {
  owner: BleAdapterOwner | null;
}

export class BleAdapterBusyError extends Error {
  readonly owner: BleAdapterOwner;

  constructor(owner: BleAdapterOwner, message: string) {
    super(message);
    this.name = 'BleAdapterBusyError';
    this.owner = owner;
  }
}

/**
 * Serializes OS Bluetooth adapter access between Noble (Meshtastic/MeshCore) and
 * Reticulum sidecar btleplug. Only one owner may hold the adapter at a time.
 */
export class BleAdapterCoordinator {
  private owner: BleAdapterOwner | null = null;
  private nobleManager: NobleBleManager | null = null;

  setNobleManager(manager: NobleBleManager): void {
    this.nobleManager = manager;
  }

  getState(): BleAdapterState {
    return { owner: this.owner };
  }

  async acquire(owner: BleAdapterOwner): Promise<void> {
    if (this.owner === owner) return;

    if (this.owner === 'reticulum-sidecar' && owner === 'noble') {
      throw new BleAdapterBusyError(
        'reticulum-sidecar',
        'Bluetooth adapter is in use by Reticulum BLE',
      );
    }

    if (this.owner === 'noble' && owner === 'reticulum-sidecar') {
      await this.releaseNobleSessions();
    }

    if (owner === 'reticulum-sidecar') {
      await this.releaseNobleSessions();
    }

    this.owner = owner;
  }

  release(owner: BleAdapterOwner): void {
    if (this.owner !== owner) return;
    this.owner = null;
  }

  assertNobleAllowed(): void {
    if (this.owner === 'reticulum-sidecar') {
      throw new BleAdapterBusyError(
        'reticulum-sidecar',
        'Bluetooth adapter is in use by Reticulum BLE',
      );
    }
  }

  private async releaseNobleSessions(): Promise<void> {
    if (!this.nobleManager) return;
    await this.nobleManager.stopAllScanning();
    await this.nobleManager.disconnectAllSessions();
    if (this.owner === 'noble') {
      this.owner = null;
    }
  }
}

export const bleAdapterCoordinator = new BleAdapterCoordinator();
