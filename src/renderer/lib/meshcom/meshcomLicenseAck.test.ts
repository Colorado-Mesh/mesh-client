import { beforeEach, describe, expect, it } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from '../appSettingsStorage';
import {
  acknowledgeMeshcomLicense,
  isMeshcomLicenseAcknowledged,
  MESHCOM_LICENSE_ACK_KEY,
  setMeshcomLicenseAcknowledged,
} from './meshcomLicenseAck';

describe('meshcomLicenseAck', () => {
  beforeEach(() => {
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
  });

  it('defaults to unacknowledged', () => {
    expect(isMeshcomLicenseAcknowledged()).toBe(false);
  });

  it('persists acknowledgment in app settings', () => {
    acknowledgeMeshcomLicense();
    expect(isMeshcomLicenseAcknowledged()).toBe(true);
    const stored = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(stored[MESHCOM_LICENSE_ACK_KEY]).toBe(true);
  });

  it('can clear acknowledgment', () => {
    setMeshcomLicenseAcknowledged(true);
    setMeshcomLicenseAcknowledged(false);
    expect(isMeshcomLicenseAcknowledged()).toBe(false);
  });
});
