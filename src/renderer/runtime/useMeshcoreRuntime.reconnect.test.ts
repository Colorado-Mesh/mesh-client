// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertPowerResumeSkipsOnExplicitDisconnect,
  extractUseCallbackBody,
  loadRuntimeSource,
} from '../lib/sourceContractTestHelpers';

const RUNTIME_SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');
const CONN_EVENTS_SOURCE = readFileSync(
  join(__dirname, '../hooks/meshcore/meshcoreConnSideEffects.ts'),
  'utf-8',
);
const RF_RX_RUNTIME_SOURCE = readFileSync(
  join(__dirname, '../lib/meshcore/meshcoreRfRxRuntime.ts'),
  'utf-8',
);

describe('useMeshcoreRuntime auto-reconnect (regression)', () => {
  it('implements exponential backoff reconnect with max attempts', () => {
    expect(RUNTIME_SOURCE).toContain('attemptMeshcoreReconnect');
    expect(RUNTIME_SOURCE).toContain('handleMeshcoreConnectionLost');
    expect(RUNTIME_SOURCE).toContain('rfMaxReconnectAttemptsForTransport');
    expect(RUNTIME_SOURCE).toContain('delayUnlessSuspended');
  });

  it('normalizes reconnect UI to disconnected when backoff aborts due to suspend', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /if \(delayResult === 'suspended'\) \{[\s\S]*?status: 'disconnected'[\s\S]*?connectionLoss: true/,
    );
  });

  it('persists connection params for ble, serial, and tcp reconnect', () => {
    expect(RUNTIME_SOURCE).toContain('meshcoreConnectionParamsRef');
    expect(RUNTIME_SOURCE).toMatch(/rfType: 'serial'/);
    expect(RUNTIME_SOURCE).toMatch(/rfType === 'tcp'/);
    expect(RUNTIME_SOURCE).toContain('verifyNobleBleRfLink');
    expect(RUNTIME_SOURCE).toContain('RF link lost after MeshCore reconnect attach');
    expect(RUNTIME_SOURCE).not.toContain('RF link not ready before MeshCore reconnect open');
  });

  it('marks everConfigured after successful initConn so auto-connect can reconnect', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /meshcoreRoomReconnectSyncRef\.current\(\);[\s\S]{0,80}meshcoreEverConfiguredRef\.current = true/,
    );
  });

  it('prepareRfConnect preserves reconnect state when requested', () => {
    const prepareBody = extractUseCallbackBody(RUNTIME_SOURCE, 'prepareRfConnect');
    expect(prepareBody).toContain('preserveReconnectState');
    expect(prepareBody).toMatch(
      /if \(!opts\?\.preserveReconnectState\) \{[\s\S]*?meshcoreIsReconnectingRef\.current = false/,
    );
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toContain('preserveReconnectState: true');
  });

  it('listens for Noble BLE adapter poweredOn to restart reconnect', () => {
    expect(RUNTIME_SOURCE).toContain('onNobleBleAdapterState');
    expect(RUNTIME_SOURCE).toContain('BLE adapter poweredOn');
  });

  it('skips Noble yield nudge when MeshCore is already connected', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /onNobleYieldReleased[\s\S]*?meshcoreDriverConnectedRef\.current \|\| connRef\.current[\s\S]*?return;/,
    );
  });

  it('skips Noble yield nudge when reconnect is already in progress', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /onNobleYieldReleased[\s\S]*?meshcoreIsReconnectingRef\.current \|\| bleConnectInProgressRef\.current[\s\S]*?skip nudge \(reconnect in progress\)/,
    );
  });

  it('exports power suspend/resume handlers wired to reconnect', () => {
    expect(RUNTIME_SOURCE).toContain('onPowerSuspend');
    expect(RUNTIME_SOURCE).toContain('onPowerResume');
    expect(RUNTIME_SOURCE).toContain('handleMeshcoreConnectionLostRef.current()');
    expect(RUNTIME_SOURCE).toContain('power resume — triggering reconnect');
    expect(RUNTIME_SOURCE).toContain('power resume — resetting reconnect budget');
    expect(RUNTIME_SOURCE).toContain('rehydrateMeshcoreConnectionParamsFromStorage');
    expect(RUNTIME_SOURCE).toContain('Noble BLE disconnected');
    expect(RUNTIME_SOURCE).toContain('meshcoreExplicitDisconnectRef');
    expect(RUNTIME_SOURCE).toContain('awaitDualNobleBleMeshtasticSettle');
    expect(RUNTIME_SOURCE).toContain('POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS');
  });

  it('defers Noble disconnect while connect or reconnect open is in flight before configure', () => {
    expect(RUNTIME_SOURCE).toContain('meshcoreReconnectConnectInFlightRef');
    expect(RUNTIME_SOURCE).toContain('meshcoreDeviceConfiguredRef');
    expect(RUNTIME_SOURCE).toMatch(
      /onNobleBleDisconnected[\s\S]*?bleConnectInProgressRef\.current \|\|[\s\S]*?meshcoreReconnectConnectInFlightRef\.current[\s\S]*?!meshcoreDeviceConfiguredRef\.current[\s\S]*?defer reconnect until connect settles/,
    );
  });

  it('does not defer Noble disconnect after active configure during remaining initConn', () => {
    expect(RUNTIME_SOURCE).toMatch(/meshcoreDeviceConfiguredRef\.current = true/);
    // Guard must use active configured ref, not everConfigured (stays true across sessions).
    expect(RUNTIME_SOURCE).toMatch(
      /!meshcoreDeviceConfiguredRef\.current[\s\S]*?defer reconnect until connect settles/,
    );
    expect(RUNTIME_SOURCE).not.toMatch(
      /!meshcoreEverConfiguredRef\.current[\s\S]{0,80}defer reconnect until connect settles/,
    );
  });

  it('bounds BLE reconnect open+attach with NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS', () => {
    expect(RUNTIME_SOURCE).toContain('NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS');
    expect(RUNTIME_SOURCE).toContain('raceWithDeadline');
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toContain('raceWithDeadline');
    expect(reconnectBody).toContain('BLE reconnect attempt timed out after');
    expect(reconnectBody).toContain('attemptActive');
    expect(reconnectBody).toContain('meshcoreReconnectConnectInFlightRef.current = true');
  });

  it('on BLE reconnect timeout invalidates setup generation and cleans late transports', () => {
    expect(RUNTIME_SOURCE).toContain('createBleReconnectTransportCleanup');
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toMatch(
      /lateTransport\.cleanup\(opened\.driverIdentityId\);\s*throw new Error\('MeshCore reconnect superseded after open'\)/,
    );
    expect(reconnectBody).toMatch(
      /lateTransport\.cleanup\(opened\.driverIdentityId\);\s*throw new Error\('MeshCore reconnect superseded during attach'\)/,
    );
    expect(reconnectBody).toMatch(
      /catch \(err\) \{[\s\S]*?isBleReconnect[\s\S]*?meshcoreSetupGenerationRef\.current \+= 1/,
    );
  });

  it('cleans up transport when RF link is lost after reconnect attach', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toMatch(
      /lateTransport\.cleanup\(opened\.driverIdentityId\);\s*throw new Error\('RF link lost after MeshCore reconnect attach'\)/,
    );
  });

  it('defers starting reconnect while open+attach is already in flight', () => {
    const lostBody = extractUseCallbackBody(RUNTIME_SOURCE, 'handleMeshcoreConnectionLost');
    expect(lostBody).toContain('meshcoreReconnectConnectInFlightRef.current');
    expect(lostBody).toContain('defer reconnect until in-flight open settles');
  });

  it('flushes deferred reconnects after reconnect attempts settle', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    const finallyBody = reconnectBody.slice(reconnectBody.indexOf('finally {'));
    expect(finallyBody).toContain('meshcoreReconnectConnectInFlightRef.current = false');
    expect(finallyBody).toContain('if (meshcoreDeferredReconnectRef.current)');
    expect(finallyBody).toContain(
      'queueMicrotask(() => handleMeshcoreConnectionLostRef.current())',
    );
  });

  it('reconnects when stored session exists before everConfigured (HMR/stale runtime)', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /Connection lost with stored session before everConfigured — reconnecting/,
    );
    expect(RUNTIME_SOURCE).toMatch(/traceRoute: no live conn — scheduling reconnect/);
  });

  it('skips reconnect on connection loss before first configure when there is no stored session', () => {
    const lostBody = extractUseCallbackBody(RUNTIME_SOURCE, 'handleMeshcoreConnectionLost');
    expect(lostBody).toMatch(
      /if \(\s*!meshcoreEverConfiguredRef\.current &&[\s\S]*?!meshcoreIsReconnectingRef\.current\s*\) \{[\s\S]*?if \(!hasStoredSession\) \{[\s\S]*?skip reconnect \(auto-connect owns retry\)[\s\S]*?return;/,
    );
    // Auto-connect (ConnectionPanel) owns the retry in this case — the reconnect loop must
    // not also kick off attemptMeshcoreReconnect for a session that never configured.
    const skipBranch = /if \(!hasStoredSession\) \{[\s\S]*?return;\s*\}/.exec(lostBody)?.[0];
    expect(skipBranch).toBeDefined();
    expect(skipBranch).not.toContain('attemptMeshcoreReconnect');
  });

  it('derives hasStoredSession from live params or rehydrated storage before deciding to skip', () => {
    const lostBody = extractUseCallbackBody(RUNTIME_SOURCE, 'handleMeshcoreConnectionLost');
    expect(lostBody).toMatch(
      /const hasStoredSession =\s*meshcoreConnectionParamsRef\.current != null \|\|\s*rehydrateMeshcoreConnectionParamsFromStorage\(\) != null;/,
    );
  });

  it('fast-fails ping when flood prime exhausts even if stale path history exists', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /const shouldAbortPing = evaluateMeshcorePingRouteAbort\(\{[\s\S]*?floodPrimeExhausted[\s\S]*?pathResolvedComposed: pathResolved\.composed/,
    );
    expect(RUNTIME_SOURCE).toMatch(
      /radioContactPathLen != null &&[\s\S]*?radioContactPathLen >= 0[\s\S]*?ensureBestPathLoaded\(nodeId\)/,
    );
  });

  it('clears bleConnectInProgressRef after auto-reconnect attempts', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /attemptMeshcoreReconnect[\s\S]{0,4000}finally \{[\s\S]*?bleConnectInProgressRef\.current = false/,
    );
    expect(RUNTIME_SOURCE).toMatch(
      /meshcoreReconnectAttemptRef\.current >= maxReconnectAttempts[\s\S]{0,400}bleConnectInProgressRef\.current = false/,
    );
  });

  it('escalates serial reconnect exhaustion with forget and re-select UI flag', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /meshcoreReconnectAttemptRef\.current >= maxReconnectAttempts[\s\S]{0,500}escalateSerialReconnectExhaustion/,
    );
    expect(RUNTIME_SOURCE).toContain('serialNeedsReselect');
    expect(RUNTIME_SOURCE).toContain('attachMeshcoreSerialTransportLossWatch');
    expect(RUNTIME_SOURCE).toContain('startMeshcoreSerialWatchdog');
    expect(RUNTIME_SOURCE).toContain('registerMeshcoreSerialDisconnectTarget');
    expect(RUNTIME_SOURCE).toContain('startSerialRediscovery');
    expect(RUNTIME_SOURCE).toContain('captureSerialIdentityForRediscovery');
  });
});

describe('useMeshcoreRuntime manual disconnect must not auto-reconnect', () => {
  it('finalizeDriverDisconnect clears reconnect session before teardown', () => {
    const finalizeBody = extractUseCallbackBody(RUNTIME_SOURCE, 'finalizeDriverDisconnect');
    expect(finalizeBody.length).toBeGreaterThan(0);
    expect(finalizeBody).toContain('meshcoreExplicitDisconnectRef.current = true');
    expect(finalizeBody).toContain('meshcoreConnectionParamsRef.current = null');
    expect(finalizeBody).toContain('meshcoreIsReconnectingRef.current = false');
    expect(finalizeBody).toContain('meshcoreReconnectAttemptRef.current = 0');
    expect(finalizeBody).toContain('meshcoreReconnectGenerationRef.current += 1');
    expect(finalizeBody).toContain('meshcoreEverConfiguredRef.current = false');
    const teardownIndex = finalizeBody.indexOf('teardownMeshcoreConnEventListeners');
    const explicitIndex = finalizeBody.indexOf('meshcoreExplicitDisconnectRef.current = true');
    expect(explicitIndex).toBeGreaterThanOrEqual(0);
    expect(teardownIndex).toBeGreaterThan(explicitIndex);
  });

  it('disconnect delegates to finalizeDriverDisconnect (Connection panel path)', () => {
    const disconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'disconnect');
    expect(disconnectBody).toContain('finalizeDriverDisconnect({ disconnectDriver: true })');
    expect(disconnectBody).not.toContain('meshcoreConnectionParamsRef.current = null');
  });

  it('handleMeshcoreConnectionLost returns early on explicit user disconnect', () => {
    const lostBody = extractUseCallbackBody(RUNTIME_SOURCE, 'handleMeshcoreConnectionLost');
    expect(lostBody).toMatch(
      /if \(meshcoreExplicitDisconnectRef\.current\) \{[\s\S]*?skip reconnect \(user disconnect\)/,
    );
  });

  it('attemptMeshcoreReconnect returns when connection params are cleared', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toMatch(
      /if \(!params\) \{[\s\S]*?meshcoreIsReconnectingRef\.current = false/,
    );
  });

  it('attemptMeshcoreReconnect returns early on explicit user disconnect', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toMatch(
      /if \(meshcoreExplicitDisconnectRef\.current\) \{[\s\S]*?meshcoreIsReconnectingRef\.current = false/,
    );
  });

  it('attemptMeshcoreReconnect treats setup AbortError as superseded reconnect', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toMatch(
      /isMeshcoreSetupAbortError\(err\)[\s\S]*?reconnect aborted \(setup superseded\)/,
    );
  });

  it('observes parallel init setup AbortErrors so sibling cancels are not unhandled', () => {
    expect(RUNTIME_SOURCE).toContain('observeMeshcoreSetupAbort');
    expect(RUNTIME_SOURCE).toMatch(
      /observeMeshcoreSetupAbort\(parallelSelfInfoPromise\)[\s\S]*?observeMeshcoreSetupAbort\(parallelContactsPromise\)/,
    );
  });

  it('periodic waiting-message poll skips idle queues', () => {
    expect(RUNTIME_SOURCE).toContain('shouldRunMeshcoreWaitingMessagesPeriodicPoll');
    expect(RUNTIME_SOURCE).toMatch(
      /shouldRunMeshcoreWaitingMessagesPeriodicPoll\(waitingMessagesCountRef\.current\)/,
    );
  });

  it('onPowerResume skips reconnect after explicit user disconnect', () => {
    assertPowerResumeSkipsOnExplicitDisconnect(
      RUNTIME_SOURCE,
      'meshcoreExplicitDisconnectRef.current',
    );
  });
});

describe('meshcoreConnSideEffects disconnected handler (regression)', () => {
  it('triggers handleConnectionLost when an operational session drops', () => {
    expect(CONN_EVENTS_SOURCE).toMatch(/case 'device_status':[\s\S]{0,400}handleDisconnected\(\)/);
    expect(CONN_EVENTS_SOURCE).toMatch(
      /handleDisconnected[\s\S]{0,2000}handleConnectionLostRef\.current\(\)/,
    );
  });

  it('skips handleConnectionLost on explicit user disconnect', () => {
    expect(CONN_EVENTS_SOURCE).toMatch(
      /if \(shouldReconnect && !meshcoreExplicitDisconnectRef\.current\)/,
    );
  });

  it('tears down ConnectionDriver on disconnect when driver path was active', () => {
    expect(CONN_EVENTS_SOURCE).toContain('meshcoreDriverConnectedRef.current');
    expect(CONN_EVENTS_SOURCE).toMatch(
      /teardownMeshcoreConnEventListeners\(\{ driverDisconnect: usedDriverConnect \}\)/,
    );
    expect(CONN_EVENTS_SOURCE).toMatch(/staleConn && !usedDriverConnect/);
  });

  it('logs rate-limited MQTT packet-log publish failures', () => {
    expect(RF_RX_RUNTIME_SOURCE).toMatch(
      /publishMeshcorePacketLog[\s\S]{0,800}MQTT packet-log publish failed/,
    );
  });

  it('marks event 131 and treats silent syncNextMessage timeout as empty queue', () => {
    expect(CONN_EVENTS_SOURCE).toContain('markMeshcoreMsgWaitingEvent()');
    expect(CONN_EVENTS_SOURCE).toMatch(/isMeshcoreSyncNextMessageTimeoutError\(e\)[\s\S]*?break;/);
  });

  it('syncs rawPacketsRef inside event 136 setRawPackets updater (same-tick hop correlation)', () => {
    expect(RF_RX_RUNTIME_SOURCE).toMatch(
      /setRawPackets\(\(prev\) => \{[\s\S]*?rawPacketsRef\.current = trimmed;[\s\S]*?return trimmed;/,
    );
  });
});

describe('useMeshcoreRuntime prepareRfConnect driver teardown (regression)', () => {
  it('awaits ConnectionDriver.disconnect before starting a new connect', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /prepareRfConnect[\s\S]{0,2500}await connectionDriver\.disconnect\(driverIdentity\)/,
    );
  });

  it('clears explicit-disconnect and reconnect refs when starting a new connect (Meshtastic parity)', () => {
    const prepareBody = extractUseCallbackBody(RUNTIME_SOURCE, 'prepareRfConnect');
    expect(prepareBody).toContain('meshcoreExplicitDisconnectRef.current = false');
    expect(prepareBody).toContain('meshcoreReconnectAttemptRef.current = 0');
    expect(prepareBody).toContain('meshcoreIsReconnectingRef.current = false');
  });
});
