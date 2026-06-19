import { describe, expect, it, vi } from 'vitest';

import { MESHCORE_INIT_TIMEOUT_MS } from '../hooks/meshcore/meshcoreHookPreamble';
import {
  MESHCORE_MQTT_IDENTITY_EXPORT_TIMEOUT_MS,
  meshcoreMqttIdentityExportMaxAttempts,
  meshcoreMqttIdentityExportTimeoutMs,
} from './meshcoreMqttIdentityExport';

describe('meshcoreMqttIdentityExport', () => {
  it('uses 60s timeout and 2 attempts for Linux BLE', () => {
    vi.stubGlobal('navigator', { userAgent: 'Linux x86_64' });
    expect(meshcoreMqttIdentityExportTimeoutMs('ble')).toBe(MESHCORE_INIT_TIMEOUT_MS);
    expect(meshcoreMqttIdentityExportMaxAttempts('ble')).toBe(2);
    vi.unstubAllGlobals();
  });

  it('uses shorter timeout and single attempt for non-Linux BLE', () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' });
    expect(meshcoreMqttIdentityExportTimeoutMs('ble')).toBe(
      MESHCORE_MQTT_IDENTITY_EXPORT_TIMEOUT_MS,
    );
    expect(meshcoreMqttIdentityExportMaxAttempts('ble')).toBe(1);
    vi.unstubAllGlobals();
  });

  it('uses shorter timeout for Linux serial', () => {
    vi.stubGlobal('navigator', { userAgent: 'Linux x86_64' });
    expect(meshcoreMqttIdentityExportTimeoutMs('serial')).toBe(
      MESHCORE_MQTT_IDENTITY_EXPORT_TIMEOUT_MS,
    );
    expect(meshcoreMqttIdentityExportMaxAttempts('serial')).toBe(1);
    vi.unstubAllGlobals();
  });
});
