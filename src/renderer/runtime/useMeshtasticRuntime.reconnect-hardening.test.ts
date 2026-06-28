// @vitest-environment jsdom
/**
 * Source contract tests for useMeshtasticRuntime reconnect hardening.
 *
 * Full renderHook integration of useMeshtasticRuntime requires extensive BLE/MQTT/IPC
 * mocking; these tests lock reconnect invariants (suspend backoff, generation bump, RF
 * verify order, exhaustion cleanup) cheaply. Prefer behavioral tests for new features;
 * extend contracts only for regression-critical wiring.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractIfBlockBody, extractUseCallbackBody } from '../lib/sourceContractTestHelpers';

const TEST_DIR = import.meta.dirname ?? __dirname;
const SOURCE = readFileSync(join(TEST_DIR, 'useMeshtasticRuntime.ts'), 'utf-8');

describe('useMeshtasticRuntime reconnect hardening (regression)', () => {
  it('uses suspend-aware delayUnlessSuspended for reconnect backoff', () => {
    expect(SOURCE).toContain('delayUnlessSuspended');
    expect(SOURCE).toMatch(/delayResult === 'suspended'/);
  });

  it('normalizes reconnect UI to disconnected when backoff aborts due to suspend', () => {
    expect(SOURCE).toMatch(
      /if \(delayResult === 'suspended'\) \{[\s\S]*?status: 'disconnected'[\s\S]*?connectionLoss: true/,
    );
  });

  it('restarts reconnect when disconnect fires during an in-flight reconnect', () => {
    expect(SOURCE).toMatch(/Connection lost during reconnect — restarting reconnect cycle/);
    expect(SOURCE).toMatch(/reconnectGenerationRef\.current \+= 1/);
  });

  it('verifies Noble BLE link after configure, not before open (disconnect must allow fresh connect)', () => {
    expect(SOURCE).toContain('verifyMeshtasticRfLink');
    expect(SOURCE).toContain('RF link lost after reconnect configure');
    expect(SOURCE).not.toContain('RF link not ready before reconnect open');
    expect(SOURCE).toMatch(/if \(type !== 'ble'\) return true/);
  });

  it('cleans up device and watchdog when reconnect budget is exhausted', () => {
    const exhaustionBlock = extractIfBlockBody(
      SOURCE,
      'reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS',
    );
    expect(exhaustionBlock.length).toBeGreaterThan(0);
    expect(exhaustionBlock).toContain('cleanupSubscriptions()');
    expect(exhaustionBlock).toContain('stopWatchdog()');
    expect(exhaustionBlock).toContain('deviceRef.current = null');
    expect(SOURCE).toContain('escalateSerialReconnectExhaustion');
    expect(SOURCE).toContain('serialNeedsReselect');
    expect(SOURCE).toContain('registerMeshtasticSerialDisconnectTarget');
  });

  it('clears reconnect refs in handleRfConnectFailure', () => {
    const failureBlock = extractUseCallbackBody(SOURCE, 'handleRfConnectFailure');
    expect(failureBlock.length).toBeGreaterThan(0);
    expect(failureBlock).toContain('isReconnectingRef.current = false');
    expect(failureBlock).toContain('reconnectGenerationRef.current += 1');
  });

  it('exports power suspend/resume handlers for usePowerRecovery', () => {
    expect(SOURCE).toContain('onPowerSuspend');
    expect(SOURCE).toContain('onPowerResume');
    expect(SOURCE).toContain('rehydrateMeshtasticConnectionParamsFromStorage');
    expect(SOURCE).toContain('handleConnectionLost safeDisconnect');
    expect(SOURCE).toContain('meshtasticExplicitDisconnectRef');
  });
});
