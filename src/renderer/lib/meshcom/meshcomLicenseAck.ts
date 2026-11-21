/**
 * MeshCom ham-license acknowledgment (App → Protocols first enable).
 *
 * Persists via the app-settings localStorage document (`meshcomLicenseAcknowledged`).
 * Failure point: localStorage / JSON parse — treat as unacknowledged; writes log and no-op.
 */

import { getAppSettingsRaw, mergeAppSetting } from '../appSettingsStorage';
import { parseStoredJson } from '../parseStoredJson';

/** App-settings key: user acknowledged MeshCom amateur-radio license notice. */
export const MESHCOM_LICENSE_ACK_KEY = 'meshcomLicenseAcknowledged';

/** True when the operator has accepted the MeshCom ham-license notice. */
export function isMeshcomLicenseAcknowledged(): boolean {
  const parsed = parseStoredJson<{ meshcomLicenseAcknowledged?: unknown }>(
    getAppSettingsRaw(),
    'isMeshcomLicenseAcknowledged',
  );
  return parsed?.meshcomLicenseAcknowledged === true;
}

/** Persist a one-time MeshCom license acknowledgment. */
export function setMeshcomLicenseAcknowledged(acked: boolean): void {
  mergeAppSetting(MESHCOM_LICENSE_ACK_KEY, acked, 'setMeshcomLicenseAcknowledged');
}

/** Acknowledge the MeshCom ham-license notice (App → Protocols first enable). */
export function acknowledgeMeshcomLicense(): void {
  setMeshcomLicenseAcknowledged(true);
}
