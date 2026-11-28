/**
 * Send MeshCom `--` / APP companion commands over Serial or BLE.
 * Imports only the lightweight wire helpers (not the Radio catalog).
 */

import type { MeshComDeviceHandle } from '../protocols/MeshComProtocol';
import { encodeMeshcomBleCommand } from './meshcomBleFrame';
import {
  buildMeshcomSettimeCommand,
  isMeshcomSensitiveCommand,
  normalizeMeshcomCommandInput,
  redactMeshcomCommandForLog,
} from './meshcomCommandWire';
import { encodeMeshcomSerialLine } from './meshcomSerial';

/** Re-export so callers can dynamic-import this module once (not meshcomCommandWire). */
export { buildMeshcomSettimeCommand };

export type MeshcomDeviceCommandTransport = MeshComDeviceHandle['transport'];

export function meshcomDeviceCommandsSupported(
  transport: MeshcomDeviceCommandTransport | null | undefined,
): boolean {
  return transport === 'serial' || transport === 'ble' || transport === 'netconsole';
}

export function encodeMeshcomDeviceCommand(
  transport: 'serial' | 'ble' | 'netconsole',
  command: string,
): Uint8Array {
  const line = normalizeMeshcomCommandInput(command);
  if (!line) {
    throw new Error('Empty MeshCom device command');
  }
  if (transport === 'serial' || transport === 'netconsole') {
    return encodeMeshcomSerialLine(line);
  }
  return encodeMeshcomBleCommand(line);
}

/**
 * Write a node command to the connected Serial/BLE/NET Console companion.
 * EXTUDP/KISS do not carry the local console / APP command channel.
 */
export async function sendMeshcomDeviceCommand(
  handle: MeshComDeviceHandle,
  command: string,
): Promise<{ command: string }> {
  if (!meshcomDeviceCommandsSupported(handle.transport)) {
    throw new Error('MeshCom device commands require Serial, BLE, or NET Console');
  }
  const normalized = normalizeMeshcomCommandInput(command);
  if (!normalized) {
    throw new Error('Empty MeshCom device command');
  }
  const bytes = encodeMeshcomDeviceCommand(
    handle.transport as 'serial' | 'ble' | 'netconsole',
    normalized,
  );
  await handle.connection.write(bytes);
  return { command: normalized };
}

export function formatMeshcomDeviceCommandForLog(command: string): string {
  return isMeshcomSensitiveCommand(command) ? redactMeshcomCommandForLog(command) : command.trim();
}
