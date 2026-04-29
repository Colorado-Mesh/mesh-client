import type { MeshProtocol } from '../../types';
import type { RadioDriver } from './RadioDriver';

const drivers = new Map<MeshProtocol, RadioDriver>();

export function setDriver(protocol: MeshProtocol, driver: RadioDriver): void {
  if (driver.protocol !== protocol) {
    throw new Error(
      `[driverRegistry] driver.protocol mismatch: registering as ${protocol} but driver.protocol is ${driver.protocol}`,
    );
  }
  drivers.set(protocol, driver);
}

export function getDriver(protocol: MeshProtocol): RadioDriver | null {
  return drivers.get(protocol) ?? null;
}

export function clearDriver(protocol: MeshProtocol): void {
  drivers.delete(protocol);
}

export function clearAllDrivers(): void {
  drivers.clear();
}
