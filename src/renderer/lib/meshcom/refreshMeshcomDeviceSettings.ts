/**
 * After Serial/BLE connect, read current node settings into the handle accumulator
 * and return a Radio-ready snapshot (MeshCore companion settings pattern for MeshCom).
 */

import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import type { MeshComDeviceHandle } from '../protocols/MeshComProtocol';
import {
  MESHCOM_BLE_SETTINGS_WAIT_MS,
  MESHCOM_SERIAL_INFO_COLLECT_MS,
  MESHCOM_SERIAL_WX_COLLECT_MS,
} from '../timeConstants';
import type { IdentityId } from '../types';
import { MESHCOM_BLE_HELLO } from './meshcomBleFrame';
import { sendMeshcomDeviceCommand } from './meshcomDeviceCommands';
import {
  emptyMeshcomDeviceSettingsAccum,
  mergeMeshcomSerialInfoText,
  mergeMeshcomSerialWxText,
  type MeshcomDeviceSettingsSnapshot,
  snapshotMeshcomDeviceSettings,
} from './meshcomDeviceSettings';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForBleConffin(handle: MeshComDeviceHandle, timeoutMs: number): Promise<void> {
  if (handle.deviceSettings.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const idx = handle.deviceSettingsWaiters.indexOf(onDone);
      if (idx >= 0) handle.deviceSettingsWaiters.splice(idx, 1);
      resolve();
    }, timeoutMs);
    const onDone = (): void => {
      clearTimeout(timer);
      resolve();
    };
    handle.deviceSettingsWaiters.push(onDone);
  });
}

async function refreshViaSerialInfo(
  handle: MeshComDeviceHandle,
  identityId: IdentityId,
): Promise<MeshcomDeviceSettingsSnapshot> {
  handle.deviceSettings = emptyMeshcomDeviceSettingsAccum();
  const lines: string[] = [];
  const detach = attachTypedPacketListener(identityId, 'device_log', (payload) => {
    if (payload.source === 'meshcom-console' && typeof payload.message === 'string') {
      lines.push(payload.message);
    }
  });
  try {
    await sendMeshcomDeviceCommand(handle, '--info');
    await sleep(MESHCOM_SERIAL_INFO_COLLECT_MS);
    mergeMeshcomSerialInfoText(handle.deviceSettings, lines.join('\n'));
    lines.length = 0;
    // Serial HELLO-equivalent does not dump weather; pull `--wx` for Telemetry.
    await sendMeshcomDeviceCommand(handle, '--wx');
    await sleep(MESHCOM_SERIAL_WX_COLLECT_MS);
    mergeMeshcomSerialWxText(handle.deviceSettings, lines.join('\n'));
  } finally {
    detach();
  }
  handle.deviceSettings.complete = true;
  return snapshotMeshcomDeviceSettings(handle.deviceSettings);
}

async function refreshViaBle(handle: MeshComDeviceHandle): Promise<MeshcomDeviceSettingsSnapshot> {
  // HELLO during connectGatt may have already filled settings; otherwise re-request.
  if (!handle.deviceSettings.complete && !handle.deviceSettings.call) {
    handle.deviceSettings = emptyMeshcomDeviceSettingsAccum();
    await handle.connection.write(MESHCOM_BLE_HELLO);
  }
  await waitForBleConffin(handle, MESHCOM_BLE_SETTINGS_WAIT_MS);
  if (!handle.deviceSettings.call) {
    // Fallback: `--info` returns TYP I over BLE even when HELLO burst was missed.
    await sendMeshcomDeviceCommand(handle, '--info');
    await waitForBleConffin(handle, MESHCOM_BLE_SETTINGS_WAIT_MS);
  }
  // Fresh weather (HELLO may omit W; Telemetry refresh always re-pulls via TYP W).
  await sendMeshcomDeviceCommand(handle, '--wx');
  await sleep(MESHCOM_SERIAL_WX_COLLECT_MS);
  handle.deviceSettings.complete = true;
  return snapshotMeshcomDeviceSettings(handle.deviceSettings);
}

/** Read node settings over Serial (`--info` + `--wx`) or BLE (`{HELLO}` / `--info` + `--wx`). */
export async function refreshMeshcomDeviceSettings(
  handle: MeshComDeviceHandle,
  identityId: IdentityId,
): Promise<MeshcomDeviceSettingsSnapshot> {
  if (handle.transport === 'serial') {
    return refreshViaSerialInfo(handle, identityId);
  }
  if (handle.transport === 'ble') {
    return refreshViaBle(handle);
  }
  throw new Error('MeshCom device settings require Serial or BLE');
}
