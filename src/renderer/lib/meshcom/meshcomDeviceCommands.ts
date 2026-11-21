/**
 * Send MeshCom `--` / APP companion commands over Serial or BLE.
 * Imports only the lightweight wire helpers (not the Radio catalog).
 */

import type { MeshComDeviceHandle } from '../protocols/MeshComProtocol';
import { encodeMeshcomBleCommand } from './meshcomBleFrame';
import {
  isMeshcomSensitiveCommand,
  normalizeMeshcomCommandInput,
  redactMeshcomCommandForLog,
} from './meshcomCommandWire';
import { encodeMeshcomSerialLine } from './meshcomSerial';

export type MeshcomDeviceCommandTransport = MeshComDeviceHandle['transport'];

export function meshcomDeviceCommandsSupported(
  transport: MeshcomDeviceCommandTransport | null | undefined,
): boolean {
  return transport === 'serial' || transport === 'ble';
}

export function encodeMeshcomDeviceCommand(
  transport: 'serial' | 'ble',
  command: string,
): Uint8Array {
  const line = normalizeMeshcomCommandInput(command);
  if (!line) {
    throw new Error('Empty MeshCom device command');
  }
  if (transport === 'serial') {
    return encodeMeshcomSerialLine(line);
  }
  return encodeMeshcomBleCommand(line);
}

/**
 * Write a node command to the connected Serial/BLE companion.
 * UDP/TCP do not carry the local console / APP command channel.
 */
export async function sendMeshcomDeviceCommand(
  handle: MeshComDeviceHandle,
  command: string,
): Promise<{ command: string }> {
  if (!meshcomDeviceCommandsSupported(handle.transport)) {
    throw new Error('MeshCom device commands require Serial or BLE');
  }
  const normalized = normalizeMeshcomCommandInput(command);
  if (!normalized) {
    throw new Error('Empty MeshCom device command');
  }
  const bytes = encodeMeshcomDeviceCommand(handle.transport as 'serial' | 'ble', normalized);
  await handle.connection.write(bytes);
  return { command: normalized };
}

export function formatMeshcomDeviceCommandForLog(command: string): string {
  return isMeshcomSensitiveCommand(command) ? redactMeshcomCommandForLog(command) : command.trim();
}
