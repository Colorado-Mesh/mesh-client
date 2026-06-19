import { withTimeout } from '../../shared/withTimeout';
import { MESHCORE_INIT_TIMEOUT_MS } from '../hooks/meshcore/meshcoreHookPreamble';
import { errLikeToLogString } from './errLikeToLogString';
import { tryPersistMeshcoreIdentityFromRadioExport } from './letsMeshJwt';
import type { MeshCoreConnection } from './meshcore/meshcoreHookTypes';
import { coerceMeshcoreExportPrivateKeyResult } from './meshcoreUtils';

/** Default exportPrivateKey timeout for Noble / serial / TCP. */
export const MESHCORE_MQTT_IDENTITY_EXPORT_TIMEOUT_MS = 15_000;

/** Delay between Linux Web Bluetooth export retries. */
export const MESHCORE_MQTT_IDENTITY_EXPORT_LINUX_BLE_RETRY_DELAY_MS = 2_000;

const MESHCORE_MQTT_IDENTITY_EXPORT_LINUX_BLE_MAX_ATTEMPTS = 2;

function isLinuxBleTransport(transportType: 'ble' | 'serial' | 'tcp'): boolean {
  return (
    transportType === 'ble' &&
    typeof navigator !== 'undefined' &&
    navigator.userAgent.toLowerCase().includes('linux')
  );
}

/** Timeout for exportPrivateKey when building the MQTT identity cache. */
export function meshcoreMqttIdentityExportTimeoutMs(
  transportType: 'ble' | 'serial' | 'tcp',
): number {
  return isLinuxBleTransport(transportType)
    ? MESHCORE_INIT_TIMEOUT_MS
    : MESHCORE_MQTT_IDENTITY_EXPORT_TIMEOUT_MS;
}

export function meshcoreMqttIdentityExportMaxAttempts(
  transportType: 'ble' | 'serial' | 'tcp',
): number {
  return isLinuxBleTransport(transportType)
    ? MESHCORE_MQTT_IDENTITY_EXPORT_LINUX_BLE_MAX_ATTEMPTS
    : 1;
}

/**
 * Export private key from the radio and merge into the active MQTT identity cache.
 * Linux Web Bluetooth uses a longer timeout and one retry to avoid racing init RPCs.
 */
export async function exportAndPersistMeshcoreMqttIdentity(
  conn: MeshCoreConnection,
  publicKey: Uint8Array,
  transportType: 'ble' | 'serial' | 'tcp',
): Promise<boolean> {
  const timeoutMs = meshcoreMqttIdentityExportTimeoutMs(transportType);
  const maxAttempts = meshcoreMqttIdentityExportMaxAttempts(transportType);
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const rawExport = await withTimeout(
        conn.exportPrivateKey(),
        timeoutMs,
        'MeshCore MQTT identity export (exportPrivateKey)',
      );
      const privBytes = coerceMeshcoreExportPrivateKeyResult(rawExport);
      if (await tryPersistMeshcoreIdentityFromRadioExport(publicKey, privBytes)) {
        return true;
      }
      lastErr = new Error('exportPrivateKey returned invalid private key material');
    } catch (e) {
      // catch-no-log-ok retry loop — final failure logged once after all attempts
      lastErr = e;
      if (attempt < maxAttempts - 1) {
        await new Promise<void>((r) =>
          setTimeout(r, MESHCORE_MQTT_IDENTITY_EXPORT_LINUX_BLE_RETRY_DELAY_MS),
        );
      }
    }
  }

  console.warn(
    '[meshcoreMqttIdentityExport] exportPrivateKey for MQTT identity cache failed ' +
      errLikeToLogString(lastErr),
  );
  return false;
}
