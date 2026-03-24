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

/**
 * Regression guard: MeshCore NUS TX (6e400003) is notify-only — it does not support GATT reads.
 * Previously, the read pump called readAsync() on it unconditionally, producing "Protocol error
 * while reading characteristic 6e400003-b5a3-f393-e0a9-e50e24dcca9e" on every connect and write.
 * Fix: session.fromRadioNotifyOnly suppresses the read pump and post-write timer entirely.
 */
describe('NobleBleManager — notify-only fromRadio read pump suppression (regression)', () => {
  it('declares fromRadioNotifyOnly in session state and initialises it to false', () => {
    expect(SOURCE).toContain('fromRadioNotifyOnly: boolean');
    // createSessionState must initialise the flag to false
    expect(SOURCE).toContain('fromRadioNotifyOnly: false,');
  });

  it('clearSessionState resets fromRadioNotifyOnly to false', () => {
    // The flag must be reset on disconnect so a reconnect starts clean
    const fnMatch = SOURCE.match(/private clearSessionState\([\s\S]+?\n {2}\}/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toContain('fromRadioNotifyOnly = false');
  });

  it('requestFromRadioReadPump returns early when fromRadioNotifyOnly is set', () => {
    // Prevents readAsync() being called on a notify-only characteristic
    expect(SOURCE).toMatch(/if \(session\.fromRadioNotifyOnly\) return/);
  });

  it('connect() assigns fromRadioNotifyOnly from fromRadioSupportsNotify', () => {
    // The flag must be derived from the actual characteristic properties at connect time
    expect(SOURCE).toMatch(/session\.fromRadioNotifyOnly\s*=\s*fromRadioSupportsNotify/);
  });

  it('writeToRadio skips the post-write read-pump timer when fromRadioNotifyOnly is set', () => {
    // MeshCore responses arrive via notify events — no polling after writes
    expect(SOURCE).toMatch(
      /if \(!session\.fromRadioNotifyOnly\)[\s\S]{0,300}postWriteReadPumpTimer/,
    );
  });
});

/**
 * Regression guard: on Linux/BlueZ, noble.state is 'unknown' at construction (async D-Bus init).
 * Seeding adapterReady from noble.state evaluates to false, so clicking Scan before the
 * stateChange event fires produced a false "Bluetooth adapter is not powered on" error.
 * Fix: startScanning waits up to 5s for the adapterState event before throwing.
 */
describe('NobleBleManager — Linux/BlueZ adapter init race (regression)', () => {
  it('defines waitForAdapterReady and resolves it via the adapterState event', () => {
    expect(SOURCE).toContain('waitForAdapterReady');
    // Must listen to the manager's own adapterState event (emitted by stateChange handler)
    expect(SOURCE).toMatch(/this\.once\('adapterState'/);
  });

  it('startScanning awaits waitForAdapterReady before throwing the adapter-not-ready error', () => {
    // Extract the startScanning method body (up to the next method declaration)
    const fnMatch = SOURCE.match(/async startScanning\b[\s\S]+?(?=\n {2}async stopScanning)/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    const waitIdx = body.indexOf('waitForAdapterReady');
    const throwIdx = body.indexOf("throw new Error('Bluetooth adapter is not powered on')");
    expect(waitIdx).toBeGreaterThan(-1);
    expect(throwIdx).toBeGreaterThan(-1);
    // The wait must precede the throw so the adapter gets a chance to initialise
    expect(waitIdx).toBeLessThan(throwIdx);
  });

  it('doStartScanning is idempotent — returns early when a scan is already active', () => {
    // Prevents double noble.startScanning() when stateChange handler and startScanning resume concurrently
    expect(SOURCE).toMatch(
      /doStartScanning[\s\S]{0,200}if \(this\.scanningActive\) return Promise\.resolve\(\)/,
    );
  });
});
