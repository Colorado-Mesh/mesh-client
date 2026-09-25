/**
 * Source contract: Meshtastic + MeshCore GATT connect must wait out Reticulum scan lease
 * via connectGattWithScanBusyRetry (not a one-shot connectGatt that hard-fails).
 *
 * Dual-radio auto-connect runs Meshtastic first; a short BLE RNode scan lease otherwise leaves
 * Meshtastic down while MeshCore connects after release.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONNECTION_SOURCE = readFileSync(join(__dirname, 'connection.ts'), 'utf-8');
const MESHCORE_TRANSPORT_SOURCE = readFileSync(
  join(__dirname, 'protocols/meshcore/MeshCoreTransport.ts'),
  'utf-8',
);
const HELPER_SOURCE = readFileSync(join(__dirname, 'bleReconnectHelper.ts'), 'utf-8');

describe('GATT scan-busy connect retry (regression)', () => {
  it('exports connectGattWithScanBusyRetry with the shared scan-busy wait budget', () => {
    expect(HELPER_SOURCE).toContain('export async function connectGattWithScanBusyRetry');
    expect(HELPER_SOURCE).toContain('BLE_SCAN_BUSY_MAX_WAIT_MS');
    expect(HELPER_SOURCE).toContain('isBleScanBusyErrorMessage');
  });

  it('Meshtastic createBleConnection uses connectGattWithScanBusyRetry', () => {
    expect(CONNECTION_SOURCE).toContain(
      "import { connectGattWithScanBusyRetry } from './bleReconnectHelper';",
    );
    expect(CONNECTION_SOURCE).toMatch(
      /await connectGattWithScanBusyRetry\(sessionId, peripheralId,\s*\{[\s\S]*shouldAbort:/,
    );
    // Must not go back to a one-shot connect that hard-fails on reticulum scan lease.
    expect(CONNECTION_SOURCE).not.toMatch(
      /const connectResult = await window\.electronAPI\.connectGatt\(sessionId, peripheralId\);/,
    );
  });

  it('MeshCore IpcSidecarGattConnection uses connectGattWithScanBusyRetry', () => {
    expect(MESHCORE_TRANSPORT_SOURCE).toContain(
      "import { connectGattWithScanBusyRetry } from '../../bleReconnectHelper';",
    );
    expect(MESHCORE_TRANSPORT_SOURCE).toContain('class IpcSidecarGattConnection');
    expect(MESHCORE_TRANSPORT_SOURCE).toMatch(
      /connectGattWithScanBusyRetry\(sessionId, this\.peripheralId,\s*\{[\s\S]*shouldAbort:/,
    );
  });
});
