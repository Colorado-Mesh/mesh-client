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

  it('bounds every reconnect open+configure with NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS', () => {
    // Applies to all transports, not just BLE (see comment at the call site): TCP/HTTP/serial
    // used to await the open+configure attempt with no ceiling at all, so a hang anywhere in
    // that sequence (e.g. a disconnect landing mid-configure) wedged reconnection forever.
    expect(SOURCE).toContain('NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS');
    expect(SOURCE).toContain('raceWithDeadline');
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toContain('raceWithDeadline');
    expect(reconnectBody).toContain('Reconnect attempt timed out after');
    expect(reconnectBody).toContain('attemptActive');
    expect(reconnectBody).not.toContain('if (isBleReconnect) {');
  });

  it('detaches wire subscriptions when a reconnect attempt times out (CodeRabbit #792)', () => {
    // wireSubscriptions() runs synchronously right after open, well before the deadline can
    // fire, so a timed-out attempt leaves the loss-watch listener and wrapped toDevice stream
    // live against the now-abandoned device unless the deadline's own catch block detaches them
    // too — lateTransport.cleanup() alone only tears down the driver/transport, not those.
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    const cleanupIdx = reconnectBody.indexOf('await lateTransport.cleanup(failedDriverIdentity);');
    expect(cleanupIdx).toBeGreaterThan(-1);
    const afterCleanup = reconnectBody.slice(cleanupIdx, cleanupIdx + 500);
    expect(afterCleanup).toContain('cleanupSubscriptions();');
  });

  it('disconnects late-opened transport when reconnect attempt is inactive or superseded', () => {
    expect(SOURCE).toContain('createBleReconnectTransportCleanup');
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toContain('lateTransport.cleanup(opened.driverIdentityId)');
    expect(reconnectBody).toMatch(
      /lateTransport\.cleanup\(opened\.driverIdentityId\);\s*throw new Error\('Reconnect superseded after open'\)/,
    );
    expect(reconnectBody).toMatch(
      /lateTransport\.cleanup\(opened\.driverIdentityId\);\s*throw new Error\('Reconnect superseded before configure'\)/,
    );
  });

  it('cleans up transport when RF link is lost after reconnect configure', () => {
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toMatch(
      /lateTransport\.cleanup\(opened\.driverIdentityId\);\s*throw new Error\('RF link lost after reconnect configure'\)/,
    );
  });

  it('defers starting reconnect while open+configure is already in flight', () => {
    const lostBody = extractUseCallbackBody(SOURCE, 'handleConnectionLost');
    expect(lostBody).toContain('reconnectConnectInFlightRef.current');
    expect(lostBody).toContain('defer reconnect until in-flight open settles');
  });

  // Source contract (not full runtime lifecycle): useMeshtasticRuntime reconnect wiring is
  // covered by source contracts per AGENTS.md; full renderHook + BLE/driver mocks are out of scope.
  it('disconnects before cleanupSubscriptions so toDevice stays defined during safeDisconnect', () => {
    const lostBody = extractUseCallbackBody(SOURCE, 'handleConnectionLost');
    const driverIdentityIdx = lostBody.indexOf(
      'meshtasticIdentityIdRef.current ?? meshtasticPendingDriverIdentityRef.current',
    );
    const safeDisconnectIdx = lostBody.indexOf('safeDisconnect(staleDevice)');
    const cleanupIdx = lostBody.indexOf('cleanupSubscriptions()');
    expect(driverIdentityIdx).toBeGreaterThanOrEqual(0);
    expect(safeDisconnectIdx).toBeGreaterThan(driverIdentityIdx);
    expect(cleanupIdx).toBeGreaterThan(safeDisconnectIdx);
  });

  it('flushes deferred reconnects after non-BLE reconnect attempts settle', () => {
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    const finallyBody = reconnectBody.slice(reconnectBody.indexOf('finally {'));
    expect(finallyBody).toContain('if (isBleReconnect) bleConnectInProgressRef.current = false;');
    expect(finallyBody).toContain('if (meshtasticDeferredReconnectRef.current)');
    expect(finallyBody).toContain('scheduleMeshtasticReconnectAttemptRef.current()');
    // Must not re-enter handleConnectionLost (double generation bump / dual backoff loops).
    expect(finallyBody).not.toContain('handleConnectionLostRef.current()');
    expect(finallyBody.indexOf('if (meshtasticDeferredReconnectRef.current)')).toBeGreaterThan(
      finallyBody.indexOf('if (isBleReconnect)'),
    );
  });

  it('handleConnectionLost defers during reconnect backoff without starting a parallel attempt', () => {
    const lostBody = extractUseCallbackBody(SOURCE, 'handleConnectionLost');
    expect(lostBody).toContain('deferForBackoff');
    expect(lostBody).toMatch(
      /deferForBackoff[\s\S]*?Connection lost during reconnect backoff — defer until delay settles/,
    );
    expect(lostBody).toMatch(
      /if \(deferForBackoff\) \{[\s\S]*?return;[\s\S]*?scheduleMeshtasticReconnectAttemptRef/,
    );
  });

  it('coalesces reconnect attempt schedules via scheduleMeshtasticReconnectAttempt', () => {
    expect(SOURCE).toContain('meshtasticReconnectSchedulePendingRef');
    expect(SOURCE).toContain('scheduleMeshtasticReconnectAttempt');
    const scheduleBody = extractUseCallbackBody(SOURCE, 'scheduleMeshtasticReconnectAttempt');
    expect(scheduleBody).toContain('meshtasticReconnectSchedulePendingRef.current');
    expect(scheduleBody).toContain('attemptReconnectRef.current()');
  });

  it('attemptReconnect clears stuck reconnecting UI when delay aborts', () => {
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toMatch(
      /delayResult === 'aborted'[\s\S]*?!isReconnectingRef\.current[\s\S]*?status: 'disconnected'/,
    );
  });

  it('attemptReconnect delay abort flushes deferred restart', () => {
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toMatch(
      /delayResult === 'aborted'[\s\S]*?meshtasticDeferredReconnectRef\.current[\s\S]*?scheduleMeshtasticReconnectAttemptRef\.current\(\)/,
    );
  });

  it('checks reconnect generation before open, wire, and configure', () => {
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toContain('Reconnect superseded before open');
    expect(reconnectBody).toContain('Reconnect superseded after open');
    expect(reconnectBody).toContain('Reconnect superseded before configure');
    expect(reconnectBody).toContain('Reconnect superseded during configure');
  });

  it('wires isBleReconnectAttemptActive from isReconnectingRef only (not in-flight alone)', () => {
    // DeviceConfiguring arm/skip is asserted in meshtasticRuntimeWireEffects.post-reboot.test.ts
    expect(SOURCE).toMatch(/isBleReconnectAttemptActive:\s*\(\)\s*=>\s*isReconnectingRef\.current/);
    expect(SOURCE).not.toMatch(
      /isBleReconnectAttemptActive:\s*\(\)\s*=>\s*isReconnectingRef\.current \|\| reconnectConnectInFlightRef/,
    );
    expect(SOURCE).toContain('reconnectConnectInFlightRef.current = false');
    const prepareBody = extractUseCallbackBody(SOURCE, 'prepareRfConnect');
    expect(prepareBody).toContain('reconnectConnectInFlightRef.current = false');
    const wireSource = readFileSync(
      join(TEST_DIR, '../lib/meshtastic/meshtasticRuntimeWireEffects.ts'),
      'utf-8',
    );
    expect(wireSource).toContain('!isBleReconnectAttemptActive()');
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
    expect(finalizeBody).toContain('reconnectConnectInFlightRef.current = false');
    expect(finalizeBody).toContain('reconnectAttemptRef.current = 0');
    expect(finalizeBody).toContain('reconnectGenerationRef.current++');
    const driverIndex = finalizeBody.indexOf('connectionDriver.disconnect');
    const explicitIndex = finalizeBody.indexOf('meshtasticExplicitDisconnectRef.current = true');
    const cleanupIdx = finalizeBody.lastIndexOf('cleanupSubscriptions()');
    expect(explicitIndex).toBeGreaterThanOrEqual(0);
    if (driverIndex >= 0) {
      expect(driverIndex).toBeGreaterThan(explicitIndex);
      expect(cleanupIdx).toBeGreaterThan(driverIndex);
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

describe('useMeshtasticRuntime Linux BLE reconnect peripheral id backfill', () => {
  it('attachRfSession backfills blePeripheralId after a gesture-based Linux connect', () => {
    const attachBody = extractUseCallbackBody(SOURCE, 'attachRfSession');
    expect(attachBody.length).toBeGreaterThan(0);
    // Guarded by `!connectionParamsRef.current.blePeripheralId` so an already-known
    // peripheralId (picker flow, Noble) is never clobbered.
    expect(attachBody).toMatch(
      /type === 'ble' &&\s*reconnectGenerationRef\.current === generation &&\s*connectionParamsRef\.current &&\s*!connectionParamsRef\.current\.blePeripheralId/,
    );
    expect(attachBody).toContain('getBlePeripheralIdFromMeshTransport(activeDevice.transport)');
    expect(attachBody).toContain(
      'connectionParamsRef.current.blePeripheralId = resolvedPeripheralId',
    );
  });

  it('gates the backfill on the generation captured at attachRfSession start (no cross-session stamping)', () => {
    // A superseded attachRfSession (newer prepareRfConnect already bumped
    // reconnectGenerationRef and replaced connectionParamsRef.current) must not write
    // its resolved device id onto a different, newer session's connectionParamsRef.
    const attachBody = extractUseCallbackBody(SOURCE, 'attachRfSession');
    const generationCaptureIdx = attachBody.indexOf(
      'const generation = reconnectGenerationRef.current',
    );
    const guardIdx = attachBody.indexOf('reconnectGenerationRef.current === generation');
    const backfillIdx = attachBody.indexOf(
      'connectionParamsRef.current.blePeripheralId = resolvedPeripheralId',
    );
    expect(generationCaptureIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeGreaterThan(generationCaptureIdx);
    expect(backfillIdx).toBeGreaterThan(guardIdx);
  });

  it('re-pushes MQTT channel keys when resolvedChannelConfigs change (RF after cold-start MQTT)', () => {
    // PacketRouter → deviceStore channel configs must re-sync topic→index after MQTT
    // connects with empty/MQTT-only maps (Colorado public LongFast on non-0 slot).
    expect(SOURCE).toMatch(
      /channelConfigsRef\.current = resolvedChannelConfigs;\s*pushMqttChannelKeys\(\);/,
    );
    expect(SOURCE).toMatch(/\[resolvedChannelConfigs, pushMqttChannelKeys\]/);
    expect(SOURCE).toMatch(/meshtasticMqttChannelKeyEntries\(channelConfigsRef\.current\)/);
    expect(SOURCE).toMatch(/updateChannelKeys\(\{\s*entries\s*\}\)/);
    // Hook-state channelConfigs alone must not be the only push trigger (stays empty on RF path).
    expect(SOURCE).not.toMatch(
      /pushMqttChannelKeys\(\);\s*\}, \[channelConfigs, mqttStatus, pushMqttChannelKeys\]/,
    );
  });
});
