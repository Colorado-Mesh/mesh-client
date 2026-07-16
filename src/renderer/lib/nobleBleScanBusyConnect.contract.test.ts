/**
 * Source contract: Meshtastic + MeshCore Noble connect must wait out Reticulum scan yield
 * via connectNobleBleWithScanBusyRetry (not a one-shot connectNobleBle that hard-fails).
 *
 * Dual-Noble auto-connect runs Meshtastic first; a short BLE RNode yield otherwise leaves
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

describe('Noble BLE scan-busy connect retry (regression)', () => {
  it('exports connectNobleBleWithScanBusyRetry with the shared scan-busy wait budget', () => {
    expect(HELPER_SOURCE).toContain('export async function connectNobleBleWithScanBusyRetry');
    expect(HELPER_SOURCE).toContain('BLE_SCAN_BUSY_MAX_WAIT_MS');
    expect(HELPER_SOURCE).toContain('isBleScanBusyErrorMessage');
  });

  it('Meshtastic createBleConnection uses connectNobleBleWithScanBusyRetry', () => {
    expect(CONNECTION_SOURCE).toContain(
      "import { connectNobleBleWithScanBusyRetry } from './bleReconnectHelper';",
    );
    expect(CONNECTION_SOURCE).toMatch(
      /await connectNobleBleWithScanBusyRetry\(sessionId, peripheralId\);/,
    );
    // Must not go back to a one-shot connect that hard-fails on reticulum yield.
    expect(CONNECTION_SOURCE).not.toMatch(
      /const connectResult = await window\.electronAPI\.connectNobleBle\(sessionId, peripheralId\);/,
    );
  });

  it('MeshCore IpcNobleConnection uses connectNobleBleWithScanBusyRetry', () => {
    expect(MESHCORE_TRANSPORT_SOURCE).toContain(
      "import { connectNobleBleWithScanBusyRetry } from '../../bleReconnectHelper';",
    );
    expect(MESHCORE_TRANSPORT_SOURCE).toMatch(
      /connectNobleBleWithScanBusyRetry\(sessionId, this\.peripheralId\)/,
    );
  });
});
