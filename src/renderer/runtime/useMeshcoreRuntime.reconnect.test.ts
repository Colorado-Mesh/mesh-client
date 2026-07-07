// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody } from '../lib/sourceContractTestHelpers';

const RUNTIME_SOURCE = readFileSync(join(__dirname, '../runtime/useMeshcoreRuntime.ts'), 'utf-8');
const CONN_EVENTS_SOURCE = readFileSync(
  join(__dirname, '../hooks/meshcore/meshcoreLegacyConnEvents.ts'),
  'utf-8',
);

describe('useMeshcoreRuntime auto-reconnect (regression)', () => {
  it('implements exponential backoff reconnect with max attempts', () => {
    expect(RUNTIME_SOURCE).toContain('attemptMeshcoreReconnect');
    expect(RUNTIME_SOURCE).toContain('handleMeshcoreConnectionLost');
    expect(RUNTIME_SOURCE).toContain('MESHCORE_MAX_RECONNECT_ATTEMPTS');
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

  it('clears bleConnectInProgressRef after auto-reconnect attempts', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /attemptMeshcoreReconnect[\s\S]{0,4000}finally \{[\s\S]*?bleConnectInProgressRef\.current = false/,
    );
    expect(RUNTIME_SOURCE).toMatch(
      /meshcoreReconnectAttemptRef\.current >= MESHCORE_MAX_RECONNECT_ATTEMPTS[\s\S]{0,400}bleConnectInProgressRef\.current = false/,
    );
  });

  it('escalates serial reconnect exhaustion with forget and re-select UI flag', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /meshcoreReconnectAttemptRef\.current >= MESHCORE_MAX_RECONNECT_ATTEMPTS[\s\S]{0,500}escalateSerialReconnectExhaustion/,
    );
    expect(RUNTIME_SOURCE).toContain('serialNeedsReselect');
    expect(RUNTIME_SOURCE).toContain('attachMeshcoreSerialTransportLossWatch');
    expect(RUNTIME_SOURCE).toContain('startMeshcoreSerialWatchdog');
    expect(RUNTIME_SOURCE).toContain('registerMeshcoreSerialDisconnectTarget');
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
});

describe('meshcoreLegacyConnEvents disconnected handler (regression)', () => {
  it('triggers handleConnectionLost when an operational session drops', () => {
    expect(CONN_EVENTS_SOURCE).toMatch(
      /onMeshcoreConn\('disconnected'[\s\S]{0,2000}handleConnectionLostRef\.current\(\)/,
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
    expect(CONN_EVENTS_SOURCE).toMatch(
      /publishMeshcorePacketLog[\s\S]{0,800}MQTT packet-log publish failed/,
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
