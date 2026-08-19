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
  extractUseCallbackBody,
  loadRendererLibSource,
  loadRuntimeSource,
} from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshtasticRuntime.ts');
const ATTEMPT_RUNNER = loadRendererLibSource('loraRfReconnectAttempt.ts');
const TEST_DIR = import.meta.dirname ?? __dirname;

describe('useMeshtasticRuntime reconnect hardening (regression)', () => {
  it('uses suspend-aware delayUnlessSuspended for reconnect backoff', () => {
    expect(SOURCE).toContain('runLoraRfReconnectAttempt');
    expect(ATTEMPT_RUNNER).toContain('delayUnlessSuspended');
    expect(ATTEMPT_RUNNER).toMatch(/delayResult === 'suspended'/);
  });

  it('normalizes reconnect UI to disconnected when backoff aborts due to suspend', () => {
    expect(ATTEMPT_RUNNER).toMatch(
      /if \(delayResult === 'suspended'\) \{[\s\S]*?setDisconnectedUi\(\{ connectionLoss: true \}\)/,
    );
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toContain('setDisconnectedUi');
    expect(reconnectBody).toMatch(/status: 'disconnected'[\s\S]*?connectionLoss: true/);
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
    expect(ATTEMPT_RUNNER).toContain('rfMaxReconnectAttemptsForTransport');
    expect(ATTEMPT_RUNNER).toContain('markExhausted()');
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toContain('onExhausted:');
    expect(reconnectBody).toContain('cleanupSubscriptions()');
    expect(reconnectBody).toContain('stopWatchdog()');
    expect(reconnectBody).toContain('deviceRef.current = null');
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
    expect(failureBlock).toContain('clearMeshtasticConfigureState()');
  });

  it('clears configure phase on reconnect attempt error', () => {
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toMatch(/onAttemptError:[\s\S]*?clearMeshtasticConfigureState\(\)/);
  });

  it('clears configure phase in requestRefresh finally', () => {
    const refreshBody = extractUseCallbackBody(SOURCE, 'requestRefresh');
    expect(refreshBody).toMatch(/finally[\s\S]*?clearMeshtasticConfigureState\(\)/);
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
    expect(reconnectBody).toContain('connectInFlight:');
    expect(ATTEMPT_RUNNER).toContain('connectInFlight.set(true)');
    expect(ATTEMPT_RUNNER).toContain('skip overlapping open');
  });

  it('bounds every reconnect open+configure with NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS', () => {
    // Shared runner applies the budget to every transport (constant name is historical).
    expect(ATTEMPT_RUNNER).toContain('NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS');
    expect(ATTEMPT_RUNNER).toContain('raceWithDeadline');
    expect(ATTEMPT_RUNNER).toContain('Reconnect attempt timed out after');
    expect(ATTEMPT_RUNNER).toContain('attemptActive');
    expect(SOURCE).toContain('runLoraRfReconnectAttempt');
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
    expect(ATTEMPT_RUNNER).toContain('createBleReconnectTransportCleanup');
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
    expect(ATTEMPT_RUNNER).toContain('bleConnectInProgress?.set(false)');
    expect(ATTEMPT_RUNNER).toContain('deferredReconnect.get()');
    expect(ATTEMPT_RUNNER).toContain('scheduleAttempt()');
    expect(ATTEMPT_RUNNER).not.toContain('handleConnectionLostRef.current()');
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toContain('scheduleMeshtasticReconnectAttemptRef.current()');
    expect(reconnectBody).toContain('bleConnectInProgress:');
  });

  it('handleConnectionLost defers when cycle already active (single-owner controller)', () => {
    const lostBody = extractUseCallbackBody(SOURCE, 'handleConnectionLost');
    expect(lostBody).toContain('onLinkLost()');
    expect(lostBody).toContain('shouldStartOwner');
    expect(lostBody).toMatch(
      /if \(!linkLost\.shouldStartOwner\) \{[\s\S]*?return;[\s\S]*?scheduleMeshtasticReconnectAttemptRef/,
    );
    expect(SOURCE).toContain('createRfReconnectController');
  });

  it('handleConnectionLost returns early on explicit user disconnect', () => {
    const lostBody = extractUseCallbackBody(SOURCE, 'handleConnectionLost');
    expect(lostBody).toMatch(
      /if \(meshtasticExplicitDisconnectRef\.current\) \{[\s\S]*?skip reconnect \(user disconnect\)/,
    );
    const explicitIdx = lostBody.indexOf('meshtasticExplicitDisconnectRef.current');
    const onLinkLostIdx = lostBody.indexOf('onLinkLost()');
    expect(explicitIdx).toBeGreaterThanOrEqual(0);
    expect(onLinkLostIdx).toBeGreaterThan(explicitIdx);
  });

  it('attemptReconnect marks controller exhausted and re-enters via onLinkLost after serial rediscovery', () => {
    expect(ATTEMPT_RUNNER).toContain('markExhausted()');
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toMatch(
      /startSerialRediscovery\(\{[\s\S]*?onFound:[\s\S]*?onLinkLost\(\)[\s\S]*?scheduleMeshtasticReconnectAttemptRef\.current\(\)/,
    );
    expect(reconnectBody).not.toMatch(
      /startSerialRediscovery\(\{[\s\S]*?onFound:[\s\S]*?void attemptReconnectRef\.current\(\)/,
    );
  });

  it('cancels controller on suspend, manual disconnect, and connect replacement', () => {
    const suspendBody = extractUseCallbackBody(SOURCE, 'onPowerSuspend');
    expect(suspendBody).toContain('meshtasticRfReconnectRef.current.cancel()');
    const finalizeBody = extractUseCallbackBody(SOURCE, 'finalizeDriverDisconnect');
    expect(finalizeBody).toContain('meshtasticRfReconnectRef.current.cancel()');
    const prepareBody = extractUseCallbackBody(SOURCE, 'prepareRfConnect');
    expect(prepareBody).toContain('meshtasticRfReconnectRef.current.cancel()');
  });

  it('coalesces reconnect attempt schedules via scheduleOwner', () => {
    expect(SOURCE).toContain('scheduleMeshtasticReconnectAttempt');
    expect(SOURCE).toContain('meshtasticRfReconnectRef');
    const scheduleBody = extractUseCallbackBody(SOURCE, 'scheduleMeshtasticReconnectAttempt');
    expect(scheduleBody).toContain('scheduleOwner');
    expect(scheduleBody).toContain('attemptReconnectRef.current()');
    expect(SOURCE).toMatch(
      /useLayoutEffect\(\(\) => \{\s*scheduleMeshtasticReconnectAttemptRef\.current = scheduleMeshtasticReconnectAttempt;\s*\}, \[scheduleMeshtasticReconnectAttempt\]\)/,
    );
  });

  it('attemptReconnect clears stuck reconnecting UI when delay aborts', () => {
    expect(ATTEMPT_RUNNER).toMatch(
      /delayResult === 'aborted'[\s\S]*?!deps\.isReconnecting\.get\(\)[\s\S]*?setDisconnectedUi/,
    );
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toMatch(/status: 'disconnected'[\s\S]*?connectionLoss: true/);
  });

  it('attemptReconnect delay abort flushes deferred restart', () => {
    expect(ATTEMPT_RUNNER).toMatch(
      /delayResult === 'aborted'[\s\S]*?deferredReconnect\.get\(\)[\s\S]*?scheduleAttempt\(\)/,
    );
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toContain('deferredReconnect:');
    expect(reconnectBody).toContain('scheduleMeshtasticReconnectAttemptRef.current()');
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
      /configure stall timeout \(BLE [\s\S]*?handleConnectionLostRef\.current\(\)/,
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
    expect(finalizeBody).toContain('meshtasticRfReconnectRef.current.cancel()');
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
    expect(ATTEMPT_RUNNER).toContain('onMissingParams?.()');
    expect(ATTEMPT_RUNNER).toMatch(/if \(!params\) \{[\s\S]*?isReconnecting\.set\(false\)/);
    const reconnectBody = extractUseCallbackBody(SOURCE, 'attemptReconnect');
    expect(reconnectBody).toContain('onMissingParams:');
    expect(reconnectBody).toContain('isReconnecting:');
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

  it('resolves channels via the pure resolveMeshtasticChannels selector, caching post-commit only', () => {
    // meshtasticIdentityId is nulled on every disconnect (cleanupSubscriptions) and only
    // restored once wire subscriptions rebind, briefly making the resolved channel list
    // fall through to the single-channel `channels` placeholder default — which used to
    // clobber ChatPanel's channel selection on every reconnect. resolveMeshtasticChannels
    // (behavior covered directly in resolveMeshtasticChannels.test.ts, no mocking needed)
    // bridges that gap via a cache; the cache write must stay out of the useMemo that
    // calls it (React may replay/discard a render, leaking uncommitted channels) and live
    // in an effect instead.
    expect(SOURCE).toContain('resolveMeshtasticChannels(');
    expect(SOURCE).toContain('lastKnownChannelsRef');
    const resolvedChannelsIdx = SOURCE.indexOf('const resolvedChannels = useMemo(');
    expect(resolvedChannelsIdx).toBeGreaterThan(-1);
    const resolvedChannelsBody = SOURCE.slice(resolvedChannelsIdx, resolvedChannelsIdx + 400);
    expect(resolvedChannelsBody).not.toContain('lastKnownChannelsRef.current =');
    expect(resolvedChannelsBody).toContain('lastKnownChannels: lastKnownChannelsRef.current');

    const cacheEffectIdx = SOURCE.indexOf(
      'useEffect(() => {\n    if (meshtasticDeviceRecord?.channels.length) {\n      lastKnownChannelsRef.current = meshtasticDeviceRecord.channels;',
    );
    expect(cacheEffectIdx).toBeGreaterThan(resolvedChannelsIdx);
  });

  it('clears the carried-forward channel list on explicit (user-initiated) disconnect only', () => {
    // Bridging the reconnect gap is only correct while an auto-reconnect is actually
    // in flight for the *same* device. A user-initiated disconnect (no reconnect
    // planned) must not leave the disconnected device's channel list lingering
    // indefinitely — cleanupSubscriptions() also runs mid-reconnect, where the flag
    // is still false and the ref must be left alone.
    const cleanupIdx = SOURCE.indexOf('const cleanupSubscriptions = useCallback(');
    expect(cleanupIdx).toBeGreaterThan(-1);
    const cleanupBody = SOURCE.slice(cleanupIdx, cleanupIdx + 1200);
    expect(cleanupBody).toMatch(
      /meshtasticExplicitDisconnectRef\.current[\s\S]*?lastKnownChannelsRef\.current = \[\]/,
    );
  });
});
