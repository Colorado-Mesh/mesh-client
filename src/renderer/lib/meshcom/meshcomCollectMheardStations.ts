/**
 * On-demand `--mheard` collection (Serial/NET Console text or BLE TYP MH JSON burst).
 */
import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import type { MeshComDeviceHandle } from '../protocols/MeshComProtocol';
import { MESHCOM_SERIAL_WX_COLLECT_MS } from '../timeConstants';
import type { IdentityId } from '../types';
import { sendMeshcomDeviceCommand } from './meshcomDeviceCommands';
import { type MeshcomMheardStation, parseMeshcomMheardText } from './meshcomMheard';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function collectMheardViaSerial(
  handle: MeshComDeviceHandle,
  identityId: IdentityId,
): Promise<MeshcomMheardStation[]> {
  const lines: string[] = [];
  const detach = attachTypedPacketListener(identityId, 'device_log', (payload) => {
    if (payload.source === 'meshcom-console' && typeof payload.message === 'string') {
      lines.push(payload.message);
    }
  });
  try {
    await sendMeshcomDeviceCommand(handle, '--mheard');
    await sleep(MESHCOM_SERIAL_WX_COLLECT_MS);
    return parseMeshcomMheardText(lines.join('\n'));
  } finally {
    detach();
  }
}

async function collectMheardViaBle(handle: MeshComDeviceHandle): Promise<MeshcomMheardStation[]> {
  const stations: MeshcomMheardStation[] = [];
  handle.mheardInFlight = stations;
  try {
    await sendMeshcomDeviceCommand(handle, '--mheard');
    await sleep(MESHCOM_SERIAL_WX_COLLECT_MS);
    return [...stations];
  } finally {
    handle.mheardInFlight = null;
  }
}

/** Fetch current MHEARD list from the connected radio (Serial/BLE/NET Console only). */
export async function collectMeshcomMheardStations(
  handle: MeshComDeviceHandle,
  identityId: IdentityId,
): Promise<MeshcomMheardStation[]> {
  if (handle.transport === 'serial' || handle.transport === 'netconsole') {
    return collectMheardViaSerial(handle, identityId);
  }
  if (handle.transport === 'ble') {
    return collectMheardViaBle(handle);
  }
  throw new Error('MeshCom MHEARD requires Serial, BLE, or NET Console');
}
