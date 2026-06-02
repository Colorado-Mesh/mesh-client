// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, '../runtime/useMeshtasticRuntime.ts'), 'utf-8');

describe('useMeshtasticRuntime reconnect hardening (regression)', () => {
  it('uses suspend-aware delayUnlessSuspended for reconnect backoff', () => {
    expect(SOURCE).toContain('delayUnlessSuspended');
    expect(SOURCE).toMatch(/delayResult === 'suspended'/);
  });

  it('restarts reconnect when disconnect fires during an in-flight reconnect', () => {
    expect(SOURCE).toMatch(/Connection lost during reconnect — restarting reconnect cycle/);
    expect(SOURCE).toMatch(/reconnectGenerationRef\.current \+= 1/);
  });

  it('verifies Noble BLE link before marking reconnect success (serial/tcp skip verify)', () => {
    expect(SOURCE).toContain('isNobleBleConnected');
    expect(SOURCE).toContain('verifyMeshtasticRfLink');
    expect(SOURCE).toMatch(/if \(type !== 'ble'\) return true/);
  });

  it('cleans up device and watchdog when reconnect budget is exhausted', () => {
    expect(SOURCE).toMatch(
      /reconnectAttemptRef\.current >= MAX_RECONNECT_ATTEMPTS[\s\S]{0,400}cleanupSubscriptions/,
    );
    expect(SOURCE).toMatch(
      /reconnectAttemptRef\.current >= MAX_RECONNECT_ATTEMPTS[\s\S]{0,400}stopWatchdog/,
    );
    expect(SOURCE).toMatch(
      /reconnectAttemptRef\.current >= MAX_RECONNECT_ATTEMPTS[\s\S]{0,400}deviceRef\.current = null/,
    );
  });

  it('exports power suspend/resume handlers for usePowerRecovery', () => {
    expect(SOURCE).toContain('onPowerSuspend');
    expect(SOURCE).toContain('onPowerResume');
  });
});
