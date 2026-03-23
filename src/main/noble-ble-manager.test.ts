// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * NobleBleManager depends on @stoprocent/noble (native). We cannot unit-test
 * startScanning() in plain Node without brittle module mocks that diverge from
 * Electron/CJS interop. Instead, lock in the stale-connected-peripheral fix
 * the same way as database.test.ts: assert the implementation still contains
 * the preservation + re-emit behavior.
 */
const SOURCE = readFileSync(join(__dirname, 'noble-ble-manager.ts'), 'utf-8');

describe('NobleBleManager.startScanning (regression)', () => {
  it('preserves connected peripherals and re-emits deviceDiscovered when clearing knownPeripherals', () => {
    expect(SOURCE).toMatch(/stillConnected/);
    expect(SOURCE).toMatch(/peripheral\.state === ['"]connected['"]/);
    expect(SOURCE).toMatch(/emit\('deviceDiscovered'/);
  });
});

/**
 * MeshCore BLE uses the Nordic UART Service (NUS), not Meshtastic's custom GATT UUIDs.
 * Regression guard: connect() must select UUIDs based on sessionId so MeshCore devices
 * don't get "Could not find all requested services" when we try to discover Meshtastic chars.
 */
describe('NobleBleManager.connect — per-session UUID selection (regression)', () => {
  it('defines MeshCore NUS UUID constants distinct from Meshtastic UUIDs', () => {
    // NUS service UUID
    expect(SOURCE).toContain('6e400001b5a3f393e0a9e50e24dcca9e');
    // NUS RX characteristic (we write to it)
    expect(SOURCE).toContain('6e400002b5a3f393e0a9e50e24dcca9e');
    // NUS TX characteristic (we read/notify from it)
    expect(SOURCE).toContain('6e400003b5a3f393e0a9e50e24dcca9e');

    // Must be separate from Meshtastic service UUID
    expect(SOURCE).toContain('6ba1b21815a8461f9fa85dcae273eafd');
  });

  it('branches on sessionId to pick the correct service UUID for discovery', () => {
    // There must be a conditional that distinguishes meshcore from meshtastic sessions
    expect(SOURCE).toMatch(/sessionId\s*===\s*['"]meshcore['"]/);
    // MeshCore path uses NUS service; Meshtastic path uses its own service UUID
    expect(SOURCE).toMatch(/MESHCORE_SERVICE_UUID/);
    expect(SOURCE).toMatch(/SERVICE_UUID/);
  });

  it('maps NUS RX char to toRadioChar and NUS TX char to fromRadioChar for meshcore sessions', () => {
    // RX uuid → toRadioChar (we write to radio via RX)
    expect(SOURCE).toMatch(/MESHCORE_RX_UUID.*toRadioChar|toRadioChar.*MESHCORE_RX_UUID/);
    // TX uuid → fromRadioChar (radio writes to us via TX)
    expect(SOURCE).toMatch(/MESHCORE_TX_UUID.*fromRadioChar|fromRadioChar.*MESHCORE_TX_UUID/);
  });

  it('does not assign fromNumChar for meshcore sessions (NUS has no equivalent)', () => {
    // The meshcore branch must not set fromNumChar — it only maps RX and TX
    const meshcoreBranchMatch = SOURCE.match(/if\s*\(isMeshcore\)\s*\{([^}]+)\}/s);
    expect(meshcoreBranchMatch).not.toBeNull();
    const meshcoreBranch = meshcoreBranchMatch![1];
    expect(meshcoreBranch).not.toContain('fromNumChar');
  });
});
