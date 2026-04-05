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

describe('NobleBleManager.doStartScanning — IPC hang guard (regression)', () => {
  it('dedupes concurrent starts with scanStartInFlight and clears it in finally', () => {
    expect(SOURCE).toContain('scanStartInFlight');
    expect(SOURCE).toMatch(/this\.scanStartInFlight = null/);
    expect(SOURCE).toContain('if (this.scanStartInFlight) return this.scanStartInFlight');
  });

  it('bounds native start with BLE_START_SCAN_TIMEOUT_MS and synchronous abandon on timeout', () => {
    expect(SOURCE).toContain('BLE_START_SCAN_TIMEOUT_MS');
    expect(SOURCE).toContain('runDoStartScanningWithTimeout');
    expect(SOURCE).toContain('noble.startScanning timed out after');
    expect(SOURCE).toContain('abandoned = true');
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

  it('meshcore skips duplicate connect IPC when already connected (WinRT handshake race)', () => {
    expect(SOURCE).toContain('connect idempotent skip');
    expect(SOURCE).toContain('duplicate IPC would disconnect and break handshake');
  });

  it('meshcore coalesces duplicate connect while GATT is still in progress', () => {
    expect(SOURCE).toContain('connect coalesce');
    expect(SOURCE).toContain('meshcoreGattInflight');
  });

  it('branches on sessionId to pick the correct service UUID for discovery', () => {
    // There must be a conditional that distinguishes meshcore from meshtastic sessions
    expect(SOURCE).toMatch(/sessionId\s*===\s*['"]meshcore['"]/);
    // MeshCore path uses NUS service; Meshtastic path uses its own service UUID
    expect(SOURCE).toMatch(/MESHCORE_SERVICE_UUID/);
    expect(SOURCE).toMatch(/SERVICE_UUID/);
  });

  it('maps NUS RX char to toRadioChar and NUS TX char to fromRadioChar for meshcore sessions', () => {
    // WinRT full discovery can list duplicate NUS UUIDs — collect candidates then pick best score
    expect(SOURCE).toContain('rxCandidates');
    expect(SOURCE).toContain('txCandidates');
    expect(SOURCE).toContain('viableRx');
    expect(SOURCE).toContain('viableTx');
    expect(SOURCE).toMatch(/meshcorePickBestChar\(\s*[\s\S]{0,80}meshcoreNusRxScore/);
    expect(SOURCE).toMatch(/meshcorePickBestChar\(\s*[\s\S]{0,80}meshcoreNusTxScore/);
  });

  it('does not assign fromNumChar for meshcore sessions (NUS has no equivalent)', () => {
    // The meshcore branch must not set fromNumChar — it only maps RX and TX
    const meshcoreBranchMatch = /if\s*\(isMeshcore\)\s*\{([^}]+)\}/s.exec(SOURCE);
    expect(meshcoreBranchMatch).not.toBeNull();
    const meshcoreBranch = meshcoreBranchMatch![1];
    expect(meshcoreBranch).not.toContain('fromNumChar');
  });
});

/**
 * Regression guard: MeshCore NUS TX may advertise both read+notify on some stacks.
 * MeshCore uses notify-only (like Web Bluetooth); GATT read on NUS TX fails on Windows WinRT.
 * Meshtastic keeps a non-Darwin read-pump safety net when notify is active.
 */
describe('NobleBleManager — notify-first fromRadio read pump strategy (regression)', () => {
  it('declares fromRadioNotifyOnly in session state and initialises it to false', () => {
    expect(SOURCE).toContain('fromRadioNotifyOnly: boolean');
    // createSessionState must initialise the flag to false
    expect(SOURCE).toContain('fromRadioNotifyOnly: false,');
  });

  it('clearSessionState resets fromRadioNotifyOnly to false', () => {
    // The flag must be reset on disconnect so a reconnect starts clean
    const fnMatch = /private clearSessionState\([\s\S]+?\n {2}\}/.exec(SOURCE);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toContain('fromRadioNotifyOnly = false');
  });

  it('centralizes read-pump gating in shouldUseFromRadioReadPump (Darwin + meshcore Win32 notify-only)', () => {
    expect(SOURCE).toContain('shouldUseFromRadioReadPump');
    expect(SOURCE).toMatch(/if \(!session\.fromRadioNotifyOnly\) return true/);
    expect(SOURCE).toMatch(/if \(IS_DARWIN\) return false/);
    expect(SOURCE).toMatch(/if \(IS_WIN32 && sessionId === 'meshcore'\) return false/);
    expect(SOURCE).toMatch(/if \(!this\.shouldUseFromRadioReadPump\(sessionId, session\)\) /);
  });

  it('connect() starts fromRadioNotifyOnly as false before strategy selection', () => {
    expect(SOURCE).toMatch(/session\.fromRadioNotifyOnly\s*=\s*false/);
  });

  it('uses notify-first strategy and logs explicit fallback-read path', () => {
    expect(SOURCE).toMatch(/if \(fromRadioSupportsNotify\)/);
    expect(SOURCE).toContain('fromRadio strategy=notify-first');
    expect(SOURCE).toContain('fromRadio subscribe failed; falling back to read-pump');
    expect(SOURCE).toContain('fromRadio strategy=fallback-read');
  });

  it('writeToRadio schedules post-write read pump only when shouldUseFromRadioReadPump is true', () => {
    expect(SOURCE).toMatch(
      /const scheduleReadPump = this\.shouldUseFromRadioReadPump\(sessionId, session\)/,
    );
    expect(SOURCE).toMatch(/scheduleReadPump[\s\S]{0,400}postWriteReadPumpTimer/);
  });

  it('logs MeshCore first-packet diagnostics with source and latency', () => {
    expect(SOURCE).toContain('first fromRadio packet via');
    expect(SOURCE).toContain('readPumpFallbackUsed=');
    expect(SOURCE).toContain('linuxEarlyPollAttempts=');
  });

  it('records whether read-pump fallback delivered payloads in session summary logs', () => {
    expect(SOURCE).toContain('fromRadioUsedReadPumpFallback');
    expect(SOURCE).toContain('session fromRadio summary');
  });
});

/**
 * Regression guard: on Linux/BlueZ, noble.state is 'unknown' at construction (async D-Bus init).
 * Seeding adapterReady from noble.state evaluates to false, so clicking Scan before the
 * stateChange event fires produced a false "Bluetooth adapter is not powered on" error.
 * Fix: startScanning waits up to 5s for the adapterState event before throwing.
 */
describe('NobleBleManager — Linux/BlueZ adapter init race (regression)', () => {
  it('defines waitForAdapterReady and keeps listening for adapterState events', () => {
    expect(SOURCE).toContain('waitForAdapterReady');
    // Must listen to the manager's own adapterState event (emitted by stateChange handler)
    expect(SOURCE).toMatch(/this\.on\('adapterState'/);
    // Should ignore transient non-ready states until timeout or poweredOn
    expect(SOURCE).toMatch(/if \(this\.adapterReady \|\| Date\.now\(\) >= deadline\)/);
  });

  it('startScanning awaits waitForAdapterReady before throwing the adapter-not-ready error', () => {
    // Extract the startScanning method body (up to the next method declaration)
    const fnMatch = /async startScanning\b[\s\S]+?(?=\n {2}async stopScanning)/.exec(SOURCE);
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
      /private doStartScanning\(\)[\s\S]*?if \(this\.scanningActive\) return Promise\.resolve\(\)/,
    );
  });
});

describe('NobleBleManager.connect — release other session on same peripheral (regression)', () => {
  it('disconnects the other protocol session instead of throwing already in use', () => {
    expect(SOURCE).toContain('releasedOtherSession');
    expect(SOURCE).toContain('await this.disconnect(otherSessionId)');
    expect(SOURCE).not.toContain('already in use by the');
  });
});
