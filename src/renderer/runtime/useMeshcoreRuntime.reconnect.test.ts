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
    // Live-socket path calls roomReconnectSync; burst-complete dead-bridge path skips it.
    // Both paths must latch everConfigured.
    expect(RUNTIME_SOURCE).toContain('meshcoreRoomReconnectSyncRef.current()');
    expect(RUNTIME_SOURCE).toContain(
      'initConn TCP burst-complete with dead bridge — skip post-connect RPCs',
    );
    expect(RUNTIME_SOURCE).toMatch(
      /meshcoreEverConfiguredRef\.current = true;[\s\S]*?\} finally \{[\s\S]*?meshcoreInitConnInFlightRef\.current = false;/,
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

  it('bounds every reconnect open+attach with NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS', () => {
    // Applies to all transports, not just BLE (see comment at the call site): TCP/serial used
    // to await the open+attach attempt with no ceiling at all, so a hang anywhere in that
    // sequence (e.g. a disconnect landing mid-attach) wedged reconnection forever — and unlike
    // serial, MeshCore TCP has no fallback watchdog either (see meshcoreSerialWatchdog).
    expect(RUNTIME_SOURCE).toContain('NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS');
    expect(RUNTIME_SOURCE).toContain('raceWithDeadline');
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toContain('raceWithDeadline');
    expect(reconnectBody).toContain('Reconnect attempt timed out after');
    expect(reconnectBody).toContain('attemptActive');
    expect(reconnectBody).toContain('meshcoreReconnectConnectInFlightRef.current = true');
    expect(reconnectBody).not.toContain('if (isBleReconnect) {\n        await raceWithDeadline');
  });

  it('on reconnect timeout invalidates setup generation and cleans late transports (any transport, CodeRabbit #792)', () => {
    // meshcoreSetupGenerationRef guards background initConn RPCs (getSelfInfo/getContacts/
    // getChannels/etc.) generically — not BLE-specific (see its other call sites). Gating the
    // bump on isBleReconnect here was only ever correct while raceWithDeadline itself was
    // BLE-only; now that every transport's reconnect races the same deadline, a timed-out
    // TCP/serial attempt must invalidate the setup generation too, or its background RPCs keep
    // running and can apply stale state after the attempt was already declared failed.
    expect(RUNTIME_SOURCE).toContain('createBleReconnectTransportCleanup');
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toMatch(
      /lateTransport\.cleanup\(opened\.driverIdentityId\);\s*throw new Error\('MeshCore reconnect superseded after open'\)/,
    );
    expect(reconnectBody).toMatch(
      /lateTransport\.cleanup\(opened\.driverIdentityId\);\s*throw new Error\('MeshCore reconnect superseded during attach'\)/,
    );
    const catchBody = reconnectBody.slice(
      reconnectBody.indexOf('} catch (err) {'),
      reconnectBody.indexOf('await lateTransport.cleanup(opened?.driverIdentityId)'),
    );
    expect(catchBody).toContain('meshcoreSetupGenerationRef.current += 1');
    expect(catchBody).not.toContain('if (isBleReconnect)');
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

  it('keeps sticky MeshCore BLE MAC suppress on connection loss and restores after BLE reconnect attach', () => {
    const lostBody = extractUseCallbackBody(RUNTIME_SOURCE, 'handleMeshcoreConnectionLost');
    expect(lostBody).toContain('prearmMeshcoreBleMacSuppressionFromStorage');
    expect(lostBody).not.toContain('setConnectedMeshcoreBleMac(null)');
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toContain('resolveConnectedMeshcoreBleIdentity');
    expect(reconnectBody).toContain('commitConnectedMeshcoreBleSuppression');
    expect(reconnectBody).toContain('readMeshcoreWebBluetoothDeviceId');
    expect(reconnectBody).toMatch(
      /Reconnect succeeded[\s\S]*?commitConnectedMeshcoreBleSuppression\(bleIdentityOpts\)/,
    );
    expect(reconnectBody).toContain('clearMeshcoreBleMacSuppression');
  });

  it('pre-arms sticky MeshCore BLE MAC on prepareRfConnect BLE and clears suppress on non-BLE', () => {
    const prepareBody = extractUseCallbackBody(RUNTIME_SOURCE, 'prepareRfConnect');
    expect(prepareBody).toContain('preserveOrClearMeshcoreBleSuppression');
    expect(prepareBody).not.toContain('setConnectedMeshcoreBleMac(null)');
    const failureBody = extractUseCallbackBody(RUNTIME_SOURCE, 'handleRfConnectFailure');
    expect(failureBody).toContain('preserveOrClearMeshcoreBleSuppression');
  });

  it('pre-arms MeshCore BLE MAC suppress on runtime mount before Meshtastic NodeDB race', () => {
    expect(RUNTIME_SOURCE).toContain('prearmMeshcoreBleMacSuppressionFromStorage');
    expect(RUNTIME_SOURCE).toMatch(
      /meshcoreHookMountedRef\.current = true;[\s\S]*?prearmMeshcoreBleMacSuppressionFromStorage\(resolveLastBlePeripheralId\('meshcore'\) \?\? null\);/,
    );
  });

  it('sets MeshCore BLE identity after connect attach including Linux Web Bluetooth without blePeripheralId', () => {
    const connectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'connect');
    expect(connectBody).toContain('resolveConnectedMeshcoreBleIdentity');
    expect(connectBody).toContain('commitConnectedMeshcoreBleSuppression');
    expect(connectBody).toContain('readMeshcoreWebBluetoothDeviceId(opened.conn)');
    expect(connectBody).toContain(
      "fallbackLastBlePeripheralId: resolveLastBlePeripheralId('meshcore')",
    );
    expect(connectBody).toContain('commitConnectedMeshcoreBleSuppression(bleIdentityOpts)');
    expect(connectBody).toContain('clearMeshcoreBleMacSuppression');
  });

  it('flushes deferred reconnects after reconnect attempts settle', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    const finallyBody = reconnectBody.slice(reconnectBody.indexOf('finally {'));
    expect(finallyBody).toContain('meshcoreReconnectConnectInFlightRef.current = false');
    expect(finallyBody).toContain('if (meshcoreDeferredReconnectRef.current)');
    expect(finallyBody).toContain('scheduleMeshcoreReconnectAttemptRef.current()');
    expect(finallyBody).not.toContain('handleMeshcoreConnectionLostRef.current()');
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
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    const finallyBody = reconnectBody.slice(reconnectBody.indexOf('finally {'));
    expect(finallyBody).toContain('bleConnectInProgressRef.current = false');
    expect(RUNTIME_SOURCE).toMatch(
      /meshcoreReconnectAttemptRef\.current >= maxReconnectAttempts[\s\S]{0,800}bleConnectInProgressRef\.current = false/,
    );
  });

  it('escalates serial reconnect exhaustion with forget and re-select UI flag', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /meshcoreReconnectAttemptRef\.current >= maxReconnectAttempts[\s\S]{0,900}escalateSerialReconnectExhaustion/,
    );
    expect(RUNTIME_SOURCE).toContain('serialNeedsReselect');
    expect(RUNTIME_SOURCE).toContain('attachMeshcoreSerialTransportLossWatch');
    expect(RUNTIME_SOURCE).toContain('startMeshcoreSerialWatchdog');
    expect(RUNTIME_SOURCE).toContain('registerMeshcoreSerialDisconnectTarget');
    expect(RUNTIME_SOURCE).toContain('startSerialRediscovery');
    expect(RUNTIME_SOURCE).toContain('captureSerialIdentityForRediscovery');
  });

  it('skips Noble BLE disconnect reconnect when connectType is not ble (TCP/serial switch)', () => {
    expect(RUNTIME_SOURCE).toMatch(
      /onNobleBleDisconnected[\s\S]*?meshcoreConnectTypeRef\.current !== 'ble'[\s\S]*?skip \(connectType=/,
    );
  });

  it('notifies immediately on main-process TCP socket disconnect (regression)', () => {
    // Unlike serial, MeshCore's TCP transport has no fallback watchdog at all (see
    // startMeshcoreSerialWatchdog, gated on rfType === 'serial'), so meshcore.tcp.onDisconnected
    // is the only automatic recovery path for a dropped TCP connection.
    expect(RUNTIME_SOURCE).toMatch(
      /window\.electronAPI\.meshcore\.tcp\.onDisconnected\(\(\) => \{[\s\S]*?latchTcpBridgeDeadForBurst\('ipc'\)/,
    );
    expect(RUNTIME_SOURCE).toContain("meshcoreConnectTypeRef.current === 'tcp'");
    expect(RUNTIME_SOURCE).toContain("latchTcpBridgeDeadForBurst('write')");
    expect(RUNTIME_SOURCE).toContain('handleMeshcoreConnectionLostRef.current()');
  });

  it('defers TCP reconnect after init burst capture instead of aborting initConn', () => {
    expect(RUNTIME_SOURCE).toContain('meshcoreTcpInitBurstCapturedRef');
    expect(RUNTIME_SOURCE).toContain('shouldDeferMeshcoreTcpReconnectAfterBurst');
    expect(RUNTIME_SOURCE).toContain(
      'TCP closed after init burst — defer reconnect until configured',
    );
    expect(RUNTIME_SOURCE).toContain(
      'TCP write-dead after init burst — latch bridge dead, defer reconnect',
    );
    expect(RUNTIME_SOURCE).toContain('setMeshcoreTcpWriteDeadListener');
    expect(RUNTIME_SOURCE).toContain('setMeshcoreTcpOpenHopDeadAccepted');
    expect(RUNTIME_SOURCE).toContain(
      'TCP write-dead on OpenHop-accepted dead bridge — keep configured',
    );
    expect(RUNTIME_SOURCE).toContain('ensureTcpLiveForUserTx');
    expect(RUNTIME_SOURCE).toContain('notifyMeshcoreTcpLiveForUserTx');
    expect(RUNTIME_SOURCE).toContain('yieldToMeshcoreTcpUserTxSends');
    // OpenHop chat send must quiet-reopen via connect() — not connection-lost (disconnect UI).
    expect(RUNTIME_SOURCE).toContain('OpenHop user TX — quiet TCP reopen (no connection-lost)');
    expect(RUNTIME_SOURCE).toContain('meshcoreOpenHopUserTxReopenInFlightRef');
    expect(RUNTIME_SOURCE).toContain('meshcoreConnectForOpenHopTxRef');
    expect(RUNTIME_SOURCE).toMatch(
      /useLayoutEffect\(\(\) => \{\s*meshcoreConnectForOpenHopTxRef\.current = connect;/,
    );
    expect(RUNTIME_SOURCE).toContain('MESHCORE_TCP_OPENHOP_USER_TX_REOPEN_DELAY_MS');
    expect(RUNTIME_SOURCE).toContain(
      'OpenHop user-TX reopen failed — restore OpenHop-accepted configured',
    );
    expect(RUNTIME_SOURCE).toContain('OpenHop user-TX reopen — skip contacts dump after live send');
    expect(RUNTIME_SOURCE).toContain(
      'TCP closed on OpenHop-accepted dead bridge — keep configured',
    );
    expect(RUNTIME_SOURCE).toMatch(
      /shouldDeferMeshcoreTcpReconnectAfterBurst\(\{[\s\S]*?burstCaptured:[\s\S]*?everConfigured:[\s\S]*?deviceConfigured:[\s\S]*?\}\)[\s\S]*?meshcoreDeferredReconnectRef\.current = true;[\s\S]*?return;[\s\S]*?handleMeshcoreConnectionLostRef\.current\(\)/,
    );
    // OpenHop: accept dead bridge without immediate reconnect (avoid FIN-after-contacts loop).
    // OpenHop-accepted suppresses background write-dead → lost; mid-session death still reconnects.
    expect(RUNTIME_SOURCE).toContain('TCP burst-complete configure — accepting dead bridge');
    expect(RUNTIME_SOURCE).toContain(
      'TCP burst-complete reconnect attach — accepting dead bridge (configured)',
    );
    expect(RUNTIME_SOURCE).not.toContain('TCP burst-complete configure — reconnecting dead bridge');
    expect(RUNTIME_SOURCE).not.toContain(
      'TCP burst-complete reconnect attach — continue for live socket',
    );
    expect(RUNTIME_SOURCE).toContain(
      'initConn getChannels skipped (TCP burst-complete, bridge dead)',
    );
  });

  it('registers runtime connect on MeshcoreSessionApi for UI Connect path (Neal OpenHop)', () => {
    // Manual Connect must use session.connect → runtime connect so TCP burst-complete
    // deferred reconnect and connectionParams latch run (useProtocolConnect must not
    // reassemble prepare/driver/attach alone — #792 params gate + burst-complete).
    expect(RUNTIME_SOURCE).toMatch(
      /registerMeshcoreSession\(\{[\s\S]*?connect,[\s\S]*?prepareRfConnect,/,
    );
    const protocolConnectSource = readFileSync(
      join(__dirname, '../hooks/useProtocolConnection.ts'),
      'utf-8',
    );
    expect(protocolConnectSource).toContain(
      'getMeshcoreSession().connect(mcType, httpAddress, blePeripheralId)',
    );
    expect(protocolConnectSource).not.toMatch(
      /protocol === 'meshcore'[\s\S]*?prepareRfConnect\(mcType\)/,
    );
  });

  it('hard-aborts TCP initConn before burst capture when bridge is dead', () => {
    expect(RUNTIME_SOURCE).toContain('meshcoreTcpBridgeDeadRef.current');
    expect(RUNTIME_SOURCE).toContain('meshcoreTcpInitBurstCapturedRef.current = true');
    const assertFnIdx = RUNTIME_SOURCE.indexOf('const assertInitConnStillLive = (): void =>');
    expect(assertFnIdx).toBeGreaterThan(-1);
    expect(RUNTIME_SOURCE.slice(assertFnIdx, assertFnIdx + 600)).toMatch(
      /tcpBurstOk[\s\S]*?return;/,
    );
    const burstSetIdx = RUNTIME_SOURCE.indexOf(
      'meshcoreTcpInitBurstCapturedRef.current = true',
      assertFnIdx,
    );
    expect(burstSetIdx).toBeGreaterThan(assertFnIdx);
    const getContactsLogIdx = RUNTIME_SOURCE.indexOf(
      'initConn getContacts ${getContactsMs}ms',
      assertFnIdx,
    );
    expect(getContactsLogIdx).toBeGreaterThan(-1);
    expect(burstSetIdx).toBeGreaterThan(getContactsLogIdx);
  });

  it('reuses discoverSelf getSelfInfo on TCP sequential initConn', () => {
    expect(RUNTIME_SOURCE).toContain('takeMeshcoreDiscoverSelfCache');
    expect(RUNTIME_SOURCE).toContain('reused discoverSelf');
    expect(RUNTIME_SOURCE).toMatch(
      /takeMeshcoreDiscoverSelfCache\(conn\)[\s\S]*?conn\.getSelfInfo\(5000\)/,
    );
    // OpenHop user-TX reopen: first companion RPC is the parked user command (skip getSelfInfo).
    expect(RUNTIME_SOURCE).toContain('OpenHop user-TX reopen — first-RPC path (skip getSelfInfo)');
    expect(RUNTIME_SOURCE).toContain('runMeshcoreOpenHopPendingUserTx');
    expect(RUNTIME_SOURCE).toContain('skipDiscoverSelf: meshcoreOpenHopUserTxReopenInFlightRef');
    expect(RUNTIME_SOURCE).not.toContain('OpenHop user-TX fresh');
    expect(RUNTIME_SOURCE).not.toContain('OpenHop user-TX reopen — bridge dead before live window');
    // Late OpenHop post-TX getChannels latched write-dead after Ok and skipped OpenHop retry.
    expect(RUNTIME_SOURCE).not.toContain('OpenHop post-TX getChannels');
    expect(RUNTIME_SOURCE).toContain('throwIfMeshcoreTcpBridgeDiedDuringOpenHopOp');
    expect(RUNTIME_SOURCE).toContain('setMeshcoreOpenHopPendingUserTx');
    expect(RUNTIME_SOURCE).toContain('runMeshcoreUserTxWithLiveTcp');
    expect(RUNTIME_SOURCE).toMatch(
      /runMeshcoreUserTxWithLiveTcp\(async \(\) => \{[\s\S]*?sendChannelTextMessage/,
    );
    // OpenHop retry must re-latch accepted so attempt 2 stays on quiet reopen.
    expect(RUNTIME_SOURCE).toContain('setMeshcoreTcpOpenHopDeadAccepted(true)');
    // Late latch after Ok: return fulfilled parked result — do not re-park (double-send).
    expect(RUNTIME_SOURCE).toContain('decideOpenHopUserTxAfterEnsureFailure');
    expect(RUNTIME_SOURCE).toContain('settleOpenHopPendingResult');
    expect(RUNTIME_SOURCE).toMatch(
      /decideOpenHopUserTxAfterEnsureFailure\([\s\S]*?decision\.action === 'return'[\s\S]*?return decision\.value/,
    );
    const openHopFirstRpcIdx = RUNTIME_SOURCE.indexOf(
      'OpenHop user-TX reopen — first-RPC path (skip getSelfInfo)',
    );
    expect(openHopFirstRpcIdx).toBeGreaterThan(-1);
    const pendingIdx = RUNTIME_SOURCE.indexOf(
      'runMeshcoreOpenHopPendingUserTx()',
      openHopFirstRpcIdx,
    );
    const latchIdx = RUNTIME_SOURCE.indexOf(
      'throwIfMeshcoreTcpBridgeDiedDuringOpenHopOp',
      openHopFirstRpcIdx,
    );
    const notifyIdx = RUNTIME_SOURCE.indexOf(
      'notifyMeshcoreTcpLiveForUserTx()',
      openHopFirstRpcIdx,
    );
    const openHopAcceptIdx = RUNTIME_SOURCE.indexOf(
      'setMeshcoreTcpOpenHopDeadAccepted(true)',
      openHopFirstRpcIdx,
    );
    const disconnectIdx = RUNTIME_SOURCE.indexOf('meshcore.tcp.disconnect()', openHopFirstRpcIdx);
    expect(pendingIdx).toBeGreaterThan(openHopFirstRpcIdx);
    expect(latchIdx).toBeGreaterThan(pendingIdx);
    expect(notifyIdx).toBeGreaterThan(latchIdx);
    // OpenHop-accept + configured before intentional disconnect (quiet teardown).
    expect(openHopAcceptIdx).toBeGreaterThan(notifyIdx);
    expect(disconnectIdx).toBeGreaterThan(openHopAcceptIdx);
    expect(RUNTIME_SOURCE).toContain('TCP closed during OpenHop user-TX reopen — keep configured');
    // OpenHop first-RPC must not dip status to connected (header flicker).
    const openHopBlock = RUNTIME_SOURCE.slice(
      openHopFirstRpcIdx,
      RUNTIME_SOURCE.indexOf('// Show persisted contacts immediately', openHopFirstRpcIdx),
    );
    expect(openHopBlock).not.toMatch(/status:\s*'connected'/);
    expect(openHopBlock).toMatch(/status:\s*'configured'/);
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
    expect(finalizeBody).toContain('meshcoreRfReconnectRef.current.cancel()');
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

  it('attemptMeshcoreReconnect marks controller exhausted and re-enters via onLinkLost after serial rediscovery', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toContain('markExhausted()');
    expect(reconnectBody).toMatch(
      /startSerialRediscovery\(\{[\s\S]*?onFound:[\s\S]*?onLinkLost\(\)[\s\S]*?scheduleMeshcoreReconnectAttemptRef\.current\(\)/,
    );
    expect(reconnectBody).not.toMatch(
      /startSerialRediscovery\(\{[\s\S]*?onFound:[\s\S]*?void attemptMeshcoreReconnectRef\.current\(\)/,
    );
  });

  it('cancels controller on suspend, manual disconnect, and connect replacement', () => {
    const suspendBody = extractUseCallbackBody(RUNTIME_SOURCE, 'onPowerSuspend');
    expect(suspendBody).toContain('meshcoreRfReconnectRef.current.cancel()');
    const finalizeBody = extractUseCallbackBody(RUNTIME_SOURCE, 'finalizeDriverDisconnect');
    expect(finalizeBody).toContain('meshcoreRfReconnectRef.current.cancel()');
    const prepareBody = extractUseCallbackBody(RUNTIME_SOURCE, 'prepareRfConnect');
    expect(prepareBody).toMatch(
      /!opts\?\.preserveReconnectState[\s\S]*?meshcoreRfReconnectRef\.current\.cancel\(\)/,
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
    // Behavioral mount of attemptMeshcoreReconnect with mocked transport + fake timers is
    // impractical for this monolithic runtime (AGENTS.md source-contract guidance). Keep
    // source contracts for the setup-abort → deferred restart + stuck-UI clear paths.
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toMatch(
      /isMeshcoreSetupAbortError\(err\)[\s\S]*?reconnect aborted \(setup superseded\)/,
    );
    // Must not clear isReconnecting on setup abort — that raced with TCP disconnect mid-initConn
    // and left status=reconnecting with no further attempts (n7eal / #792 MeshCore TCP).
    const abortIdx = reconnectBody.indexOf('isMeshcoreSetupAbortError(err)');
    expect(abortIdx).toBeGreaterThan(-1);
    const abortBlock = reconnectBody.slice(abortIdx, abortIdx + 900);
    expect(abortBlock).toContain('meshcoreDeferredReconnectRef.current = true');
    expect(abortBlock).not.toMatch(/meshcoreIsReconnectingRef\.current = false/);
  });

  it('attemptMeshcoreReconnect clears stuck reconnecting UI when delay aborts', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toMatch(
      /delayResult === 'aborted'[\s\S]*?!meshcoreIsReconnectingRef\.current[\s\S]*?status: 'disconnected'/,
    );
  });

  it('attemptMeshcoreReconnect clears stuck UI when generation mismatches after delay', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    // Post-delay guard: generation bump or cleared isReconnecting must not leave status=reconnecting.
    expect(reconnectBody).toMatch(
      /meshcoreReconnectGenerationRef\.current !== generation[\s\S]*?!meshcoreIsReconnectingRef\.current[\s\S]*?status: 'disconnected'/,
    );
  });

  it('attemptMeshcoreReconnect finally flushes deferred restart via coalesced schedule', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    const abortIdx = reconnectBody.indexOf('isMeshcoreSetupAbortError(err)');
    expect(abortIdx).toBeGreaterThan(-1);
    const afterAbort = reconnectBody.slice(abortIdx);
    expect(afterAbort).toMatch(
      /finally[\s\S]*?meshcoreDeferredReconnectRef\.current[\s\S]*?scheduleMeshcoreReconnectAttemptRef\.current\(\)/,
    );
    // Must not re-enter handleMeshcoreConnectionLost (double generation bump / dual backoff loops).
    expect(afterAbort).not.toMatch(
      /finally[\s\S]*?meshcoreDeferredReconnectRef\.current[\s\S]*?handleMeshcoreConnectionLostRef\.current\(\)/,
    );
  });

  it('handleMeshcoreConnectionLost defers when cycle already active (single-owner controller)', () => {
    const lostBody = extractUseCallbackBody(RUNTIME_SOURCE, 'handleMeshcoreConnectionLost');
    expect(lostBody).toContain('onLinkLost()');
    expect(lostBody).toContain('shouldStartOwner');
    expect(lostBody).toMatch(
      /if \(!linkLost\.shouldStartOwner\) \{[\s\S]*?return;[\s\S]*?scheduleMeshcoreReconnectAttemptRef/,
    );
    expect(RUNTIME_SOURCE).toContain('createRfReconnectController');
  });

  it('bumps setup generation synchronously in handleMeshcoreConnectionLost (Neal TCP mid-initConn)', () => {
    const lostBody = extractUseCallbackBody(RUNTIME_SOURCE, 'handleMeshcoreConnectionLost');
    const bumpIdx = lostBody.indexOf('meshcoreSetupGenerationRef.current += 1');
    const asyncIdx = lostBody.indexOf('void (async () =>');
    expect(bumpIdx).toBeGreaterThan(-1);
    expect(asyncIdx).toBeGreaterThan(-1);
    expect(bumpIdx).toBeLessThan(asyncIdx);
    expect(lostBody.slice(asyncIdx)).not.toContain('meshcoreSetupGenerationRef.current += 1');
  });

  it('latches session before contacts dump and soft-fails without clobbering hydration', () => {
    expect(RUNTIME_SOURCE).toContain('configureBeforeContactsDump');
    expect(RUNTIME_SOURCE).toContain('promoteConfiguredAfterContactsDump');
    expect(RUNTIME_SOURCE).toContain('meshcoreTcpContactsDumpInFlightRef');
    expect(RUNTIME_SOURCE).toContain('assertInitConnStillLive');
    expect(RUNTIME_SOURCE).toContain('rethrowMeshcoreSetupAbortFromTcpDead');
    expect(RUNTIME_SOURCE).toContain('isMeshcoreTcpTransportDeadError');
    expect(RUNTIME_SOURCE).toContain('getContacts failed after configured — keeping session');
    expect(RUNTIME_SOURCE).toContain(
      'TCP closed during post-configure contacts dump — keep configured',
    );
    expect(RUNTIME_SOURCE).toContain('contactsDumpOk');
    expect(RUNTIME_SOURCE).toContain('contacts dump soft-failed — preserving dbCache hydration');
  });

  it('coalesces reconnect attempt schedules via scheduleOwner', () => {
    expect(RUNTIME_SOURCE).toContain('scheduleMeshcoreReconnectAttempt');
    expect(RUNTIME_SOURCE).toContain('meshcoreRfReconnectRef');
    const scheduleBody = extractUseCallbackBody(RUNTIME_SOURCE, 'scheduleMeshcoreReconnectAttempt');
    expect(scheduleBody).toContain('scheduleOwner');
    expect(scheduleBody).toContain('attemptMeshcoreReconnectRef.current()');
    expect(RUNTIME_SOURCE).toMatch(
      /useLayoutEffect\(\(\) => \{\s*attemptMeshcoreReconnectRef\.current = attemptMeshcoreReconnect;\s*\}, \[attemptMeshcoreReconnect\]\)/,
    );
    expect(RUNTIME_SOURCE).toMatch(
      /useLayoutEffect\(\(\) => \{\s*scheduleMeshcoreReconnectAttemptRef\.current = scheduleMeshcoreReconnectAttempt;\s*\}, \[scheduleMeshcoreReconnectAttempt\]\)/,
    );
  });

  it('attemptMeshcoreReconnect delay abort flushes deferred restart', () => {
    const reconnectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptMeshcoreReconnect');
    expect(reconnectBody).toMatch(
      /delayResult === 'aborted'[\s\S]*?meshcoreDeferredReconnectRef\.current[\s\S]*?scheduleMeshcoreReconnectAttemptRef\.current\(\)/,
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

  it('defers post-connect self telemetry once when waiting-message drain is busy', () => {
    expect(RUNTIME_SOURCE).toContain('schedulePostConnectSelfTelemetry');
    expect(RUNTIME_SOURCE).toContain(
      'post-connect self telemetry deferred (waiting-message drain busy)',
    );
    expect(RUNTIME_SOURCE).toContain(
      'post-connect self telemetry skipped (waiting-message drain still busy)',
    );
    expect(RUNTIME_SOURCE).toMatch(
      /schedulePostConnectSelfTelemetry = \(allowReschedule: boolean\)[\s\S]*?waitingMessagesDrainBusyRef\.current[\s\S]*?schedulePostConnectSelfTelemetry\(false\)/,
    );
    expect(RUNTIME_SOURCE).toMatch(
      /if \(waitingMessagesDrainBusyRef\.current\) \{[\s\S]*?schedulePostConnectSelfTelemetry\(false\);[\s\S]*?\} else \{[\s\S]*?schedulePostConnectSelfTelemetry\(true\);/,
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
      /handleDisconnected[\s\S]{0,3000}handleConnectionLostRef\.current\(\)/,
    );
  });

  it('skips TCP device_status disconnect teardown (runtime owns OpenHop bridge recovery)', () => {
    // OpenHop FIN emits device_status via TcpOverIpc; tearing down the driver here left
    // "accepting dead bridge" with no handle and no scheduled reconnect.
    expect(CONN_EVENTS_SOURCE).toMatch(/meshcoreConnectTypeRef\.current === 'tcp'[\s\S]*?return;/);
  });

  it('tears down ConnectionDriver on non-TCP disconnect when driver path was active', () => {
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

  it('always bumps setupGeneration and disconnects TCP bridge (BLE vs TCP race)', () => {
    const prepareBody = extractUseCallbackBody(RUNTIME_SOURCE, 'prepareRfConnect');
    expect(prepareBody).toMatch(/meshcoreSetupGenerationRef\.current \+= 1/);
    expect(prepareBody).toContain('window.electronAPI.meshcore.tcp.disconnect()');
    expect(prepareBody).toContain('meshcorePendingDriverIdentityRef.current');
  });

  it('clears OpenHop dead-bridge latch on every prepareRfConnect (not TCP-only)', () => {
    const prepareBody = extractUseCallbackBody(RUNTIME_SOURCE, 'prepareRfConnect');
    const openHopClearIdx = prepareBody.indexOf('setMeshcoreTcpOpenHopDeadAccepted(false)');
    const bridgeClearIdx = prepareBody.indexOf('meshcoreTcpBridgeDeadRef.current = false');
    const tcpGuardIdx = prepareBody.indexOf("if (type === 'tcp')");
    expect(openHopClearIdx).toBeGreaterThan(-1);
    expect(bridgeClearIdx).toBeGreaterThan(-1);
    expect(tcpGuardIdx).toBeGreaterThan(-1);
    expect(openHopClearIdx).toBeLessThan(tcpGuardIdx);
    expect(bridgeClearIdx).toBeLessThan(tcpGuardIdx);
  });

  it('clears connection params on manual prepare and latches provisional params before open', () => {
    const prepareBody = extractUseCallbackBody(RUNTIME_SOURCE, 'prepareRfConnect');
    expect(prepareBody).toMatch(
      /if \(!opts\?\.preserveReconnectState\) \{\s*meshcoreConnectionParamsRef\.current = null;/,
    );
    const connectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'connect');
    expect(connectBody).toMatch(
      /await prepareRfConnect\(type\);[\s\S]*?meshcoreConnectionParamsRef\.current = \{[\s\S]*?rfType: type,/,
    );
  });

  it('latches pending driver identity after open before attach (mid-open supersede)', () => {
    const connectBody = extractUseCallbackBody(RUNTIME_SOURCE, 'connect');
    expect(connectBody).toMatch(
      /meshcorePendingDriverIdentityRef\.current = opened\.driverIdentityId/,
    );
    expect(connectBody).toMatch(
      /meshcoreSetupGenerationRef\.current !== connectSetupGen[\s\S]*?MESHCORE_SETUP_ABORT_MESSAGE/,
    );
  });
});
