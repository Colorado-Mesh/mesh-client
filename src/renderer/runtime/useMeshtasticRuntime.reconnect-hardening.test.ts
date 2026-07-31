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

import {
  assertPowerResumeSkipsOnExplicitDisconnect,
  extractIfBlockBody,
  extractUseCallbackBody,
  loadRuntimeSource,
} from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshtasticRuntime.ts');
const TEST_DIR = import.meta.dirname ?? __dirname;

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
    expect(SOURCE).toContain('verifyNobleBleRfLink');
    expect(SOURCE).toContain('RF link lost after reconnect configure');
    expect(SOURCE).not.toContain('RF link not ready before reconnect open');
  });

  it('cleans up device and watchdog when reconnect budget is exhausted', () => {
    expect(SOURCE).toContain('rfMaxReconnectAttemptsForTransport');
    const exhaustionBlock = extractIfBlockBody(
      SOURCE,
      'reconnectAttemptRef.current >= maxReconnectAttempts',
    );
    expect(exhaustionBlock.length).toBeGreaterThan(0);
    expect(exhaustionBlock).toContain('cleanupSubscriptions()');
    expect(exhaustionBlock).toContain('stopWatchdog()');
    expect(exhaustionBlock).toContain('deviceRef.current = null');
    expect(SOURCE).toContain('escalateSerialReconnectExhaustion');
    expect(SOURCE).toContain('serialNeedsReselect');
    expect(SOURCE).toContain('registerMeshtasticSerialDisconnectTarget');
    expect(SOURCE).toContain('startSerialRediscovery');
    expect(SOURCE).toContain('captureSerialIdentityForRediscovery');
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

  it('rehydrates connection params from storage on Noble BLE disconnect when ref is empty', () => {
    expect(SOURCE).toContain('onNobleBleDisconnected');
    expect(SOURCE).toMatch(
      /onNobleBleDisconnected[\s\S]*?rehydrateMeshtasticConnectionParamsFromStorage[\s\S]*?handleConnectionLostRef\.current\(\)/,
    );
  });

  it('logs at debug when Noble yield release nudges reconnect', () => {
    expect(SOURCE).toMatch(/nobleYieldReconnectNudgeRef\.current = true/);
    expect(SOURCE).toMatch(
      /afterNobleYieldRelease[\s\S]*?Noble BLE yield released — initiating Meshtastic reconnect/,
    );
  });

  it('skips Noble yield nudge when Meshtastic is configured and connected', () => {
    expect(SOURCE).toMatch(
      /onNobleYieldReleased[\s\S]*?meshtasticDriverConnectedRef\.current && deviceConfiguredRef\.current[\s\S]*?return;/,
    );
  });

  it('skips Noble yield nudge when reconnect is already in progress', () => {
    expect(SOURCE).toMatch(
      /onNobleYieldReleased[\s\S]*?isReconnectingRef\.current \|\| bleConnectInProgressRef\.current[\s\S]*?skip nudge \(reconnect in progress\)/,
    );
  });

  it('defers Noble disconnect reconnect while intentional BLE connect is in progress', () => {
    expect(SOURCE).toContain('bleConnectInProgressRef');
    expect(SOURCE).toMatch(
      /onNobleBleDisconnected[\s\S]*?bleConnectInProgressRef\.current[\s\S]*?defer reconnect until connect settles/,
    );
  });

  it('defers Noble disconnect during reconnect open/configure (single-flight)', () => {
    expect(SOURCE).toContain('reconnectConnectInFlightRef');
    expect(SOURCE).toMatch(
      /onNobleBleDisconnected[\s\S]*?reconnectConnectInFlightRef\.current[\s\S]*?defer reconnect until connect settles/,
    );
  });

  it('wraps BLE reconnect open in withNobleBleConnectMutex (MeshCore parity)', () => {
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toContain("withNobleBleConnectMutex('meshtastic'");
    expect(reconnectBody).toContain('reconnectConnectInFlightRef.current = true');
    expect(reconnectBody).toContain('skip overlapping open');
  });

  it('defers starting reconnect while open+configure is already in flight', () => {
    const lostBody = extractUseCallbackBody(SOURCE, 'handleConnectionLost');
    expect(lostBody).toContain('reconnectConnectInFlightRef.current');
    expect(lostBody).toContain('defer reconnect until in-flight open settles');
  });

  it('flushes deferred reconnects after non-BLE reconnect attempts settle', () => {
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    const finallyBody = reconnectBody.slice(reconnectBody.indexOf('finally {'));
    expect(finallyBody).toContain('if (isBleReconnect) bleConnectInProgressRef.current = false;');
    expect(finallyBody).toContain('if (meshtasticDeferredReconnectRef.current)');
    expect(finallyBody).toContain('queueMicrotask(() => handleConnectionLostRef.current())');
    expect(finallyBody.indexOf('if (meshtasticDeferredReconnectRef.current)')).toBeGreaterThan(
      finallyBody.indexOf('if (isBleReconnect)'),
    );
  });

  it('checks reconnect generation before open, wire, and configure', () => {
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toContain('Reconnect superseded before open');
    expect(reconnectBody).toContain('Reconnect superseded after open');
    expect(reconnectBody).toContain('Reconnect superseded before configure');
    expect(reconnectBody).toContain('Reconnect superseded during configure');
  });

  it('BLE configure timeout routes through handleConnectionLost (reconnect)', () => {
    const wireSource = readFileSync(
      join(TEST_DIR, '../lib/meshtastic/meshtasticRuntimeWireEffects.ts'),
      'utf-8',
    );
    expect(wireSource).toMatch(
      /configure timeout \(BLE 30s\)[\s\S]*?handleConnectionLostRef\.current\(\)/,
    );
  });

  it('guards attachRfSession configure against reconnect generation supersession', () => {
    expect(SOURCE).toMatch(
      /attachRfSession[\s\S]{0,3500}reconnectGenerationRef\.current !== generation[\s\S]{0,200}Attach superseded during configure/,
    );
  });

  it('uses nodeStore as the merge base and synchronizes runtime patches immediately', () => {
    const updateNodesBody = extractUseCallbackBody(SOURCE, 'updateNodes');
    expect(updateNodesBody).toContain('getIdentityNodeMap(identityId)');
    expect(updateNodesBody).toContain('syncNodesMapToIdentityStore(identityId, next)');
    expect(SOURCE).not.toMatch(
      /useEffect\(\(\) => \{[\s\S]{0,250}syncNodesMapToIdentityStore\(storeId, nodes\)/,
    );
  });
});

describe('useMeshtasticRuntime manual disconnect must not auto-reconnect', () => {
  it('finalizeDriverDisconnect clears reconnect session before driver teardown', () => {
    const finalizeBody = extractUseCallbackBody(SOURCE, 'finalizeDriverDisconnect');
    expect(finalizeBody.length).toBeGreaterThan(0);
    expect(finalizeBody).toContain('meshtasticExplicitDisconnectRef.current = true');
    expect(finalizeBody).toContain('connectionParamsRef.current = null');
    expect(finalizeBody).toContain('isReconnectingRef.current = false');
    expect(finalizeBody).toContain('reconnectAttemptRef.current = 0');
    expect(finalizeBody).toContain('reconnectGenerationRef.current++');
    const driverIndex = finalizeBody.indexOf('connectionDriver.disconnect');
    const explicitIndex = finalizeBody.indexOf('meshtasticExplicitDisconnectRef.current = true');
    expect(explicitIndex).toBeGreaterThanOrEqual(0);
    if (driverIndex >= 0) {
      expect(driverIndex).toBeGreaterThan(explicitIndex);
    }
  });

  it('attemptReconnect returns when connection params are cleared', () => {
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toMatch(/if \(!params\) \{[\s\S]*?isReconnectingRef\.current = false/);
  });

  it('Noble BLE disconnect handler respects explicit user disconnect before rehydrate', () => {
    expect(SOURCE).toMatch(
      /onNobleBleDisconnected[\s\S]*?meshtasticExplicitDisconnectRef\.current[\s\S]*?skip reconnect \(user disconnect\)/,
    );
  });

  it('onPowerResume skips reconnect after explicit user disconnect', () => {
    assertPowerResumeSkipsOnExplicitDisconnect(SOURCE, 'meshtasticExplicitDisconnectRef.current');
  });
});
