// @vitest-environment jsdom
/**
 * Source contract tests for useReticulumRuntime sidecar reconnect hardening.
 */
import { describe, expect, it } from 'vitest';

import {
  assertPowerResumeSkipsOnExplicitDisconnect,
  extractUseCallbackBody,
  loadRuntimeSource,
} from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useReticulumRuntime.ts');

describe('useReticulumRuntime reconnect hardening (regression)', () => {
  it('ignores sidecar stop status while connect is in flight', () => {
    expect(SOURCE).toMatch(
      /if \(status\.running\) return;[\s\S]*?if \(connectInFlightRef\.current\) return;/,
    );
  });

  it('awaits in-flight stack ops instead of silent no-op on connect', () => {
    expect(SOURCE).toMatch(
      /if \(connectInFlightRef\.current\) \{[\s\S]*?connectInFlightDoneRef\.current[\s\S]*?await pending/,
    );
    expect(SOURCE).not.toMatch(
      /const connect = useCallback\(async \(\) => \{[\s\S]*?if \(connectInFlightRef\.current\) return;/,
    );
  });

  it('re-runs connect after coalescing when reuseIfRunning is false', () => {
    const connectBody = extractUseCallbackBody(SOURCE, 'connect');
    expect(connectBody).toContain('opts?.reuseIfRunning !== false');
    const awaitPendingIdx = connectBody.indexOf('await pending.catch');
    const coalescedReturnIdx = connectBody.indexOf(
      'if (opts?.reuseIfRunning !== false)',
      awaitPendingIdx,
    );
    expect(awaitPendingIdx).toBeGreaterThan(-1);
    expect(coalescedReturnIdx).toBeGreaterThan(awaitPendingIdx);
    // Fresh-start falls through into a new flight rather than returning early.
    expect(connectBody.slice(coalescedReturnIdx, coalescedReturnIdx + 120)).toContain('return;');
  });

  it('restartStack awaits in-flight connect before restarting', () => {
    expect(SOURCE).toMatch(
      /const restartStack = useCallback\(async \(\) => \{[\s\S]*?if \(connectInFlightRef\.current\) \{[\s\S]*?await pending/,
    );
    expect(SOURCE).not.toMatch(
      /const restartStack = useCallback\(async \(\) => \{[\s\S]*?if \(connectInFlightRef\.current\) \{\s*return;/,
    );
  });

  it('does not treat connecting as an active session for sidecar stop reconnect', () => {
    expect(SOURCE).toMatch(
      /const wasActive =[\s\S]*?stateRef\.current\.status === 'configured'[\s\S]*?stateRef\.current\.status === 'connected'[\s\S]*?stateRef\.current\.status === 'stale'/,
    );
    expect(SOURCE).not.toMatch(/const wasActive = stateRef\.current\.status !== 'disconnected'/);
  });

  it('holds Noble BLE yield while sidecar status is connecting', () => {
    expect(SOURCE).toMatch(
      /const sidecarActiveForBleYield =[\s\S]*?state\.status === 'connecting'[\s\S]*?state\.status === 'configured'[\s\S]*?state\.status === 'connected'[\s\S]*?state\.status === 'stale'/,
    );
    expect(SOURCE).toMatch(/useReticulumNobleBleYieldWatcher\(sidecarActiveForBleYield\)/);
  });
});

describe('useReticulumRuntime manual disconnect must not auto-reconnect', () => {
  it('finalizeDriverDisconnect delegates to full disconnect', () => {
    expect(SOURCE).toMatch(
      /finalizeDriverDisconnect: async \(\) => \{[\s\S]*?await disconnect\(\)/,
    );
  });

  it('disconnect sets suppressReconnect before stopping sidecar', () => {
    const disconnectRe =
      /const disconnect = useCallback\(async \(\) => \{[\s\S]*?\}, \[syncConnectionStore\]\);/;
    const disconnectBody = disconnectRe.exec(SOURCE)?.[0];
    expect(disconnectBody).toBeDefined();
    expect(disconnectBody).toContain('suppressReconnectRef.current = true');
    expect(disconnectBody).toContain('setReticulumManualStackStopSuppress(true)');
    const suppressIndex = disconnectBody!.indexOf('suppressReconnectRef.current = true');
    const stopIndex = disconnectBody!.indexOf('reticulum.stop()');
    expect(suppressIndex).toBeGreaterThanOrEqual(0);
    expect(stopIndex).toBeGreaterThan(suppressIndex);
  });

  it('sidecar stop autostart reconnect respects suppressReconnect', () => {
    expect(SOURCE).toMatch(
      /if \(!suppressReconnectRef\.current && isReticulumAutostartEnabled\(\)\) \{/,
    );
  });

  it('keeps suppressReconnect sticky across sidecar stop (cleared only by connect)', () => {
    // Manual Stop/Disconnect must stay suppressed through stop status and power resume
    // until an intentional connect() clears the flag.
    const onStatusRe =
      /window\.electronAPI\.reticulum\.onStatus\(\(status\) => \{[\s\S]*?\n {4}\}\);/;
    const onStatusBody = onStatusRe.exec(SOURCE)?.[0];
    expect(onStatusBody).toBeDefined();
    expect(onStatusBody).toMatch(
      /if \(wasActive\) \{[\s\S]*?if \(!suppressReconnectRef\.current && isReticulumAutostartEnabled\(\)\) \{/,
    );
    expect(onStatusBody).not.toMatch(/suppressReconnectRef\.current = false/);

    const connectBody = extractUseCallbackBody(SOURCE, 'connect');
    expect(connectBody).toMatch(/isReticulumManualStackStopSuppress\(\)/);
    expect(connectBody).toMatch(
      /suppressReconnectRef\.current = false;\s*connectInFlightRef\.current = true;/,
    );
  });

  it('onPowerResume skips reconnect after explicit user disconnect', () => {
    assertPowerResumeSkipsOnExplicitDisconnect(SOURCE, 'suppressReconnectRef.current');
  });
});

describe('useReticulumRuntime resume-generation cancel (H7)', () => {
  it('onPowerSuspend bumps resumeGenerationRef instead of being a no-op', () => {
    expect(SOURCE).toMatch(
      /const onPowerSuspend = useCallback\(\(\) => \{\s*resumeGenerationRef\.current \+= 1;[\s\S]*?\}, \[\]\);/,
    );
    expect(SOURCE).toMatch(/resumeGenerationRef\.current \+= 1;/);
    // Pause Remote shell/transfer retry storms while asleep.
    expect(SOURCE).toMatch(/useRnshSessionStore\.getState\(\)\.clearAll\(\)/);
    expect(SOURCE).toMatch(/useRncpTransferStore\.getState\(\)\.clearAll\(\)/);
    // Regression: the runtime object used to return a literal no-op for onPowerSuspend.
    expect(SOURCE).not.toMatch(/onPowerSuspend: \(\) => \{\},/);
  });

  it('wires the real onPowerSuspend callback into the returned runtime object', () => {
    expect(SOURCE).toMatch(/restartStack,\s*onPowerSuspend,\s*onPowerResume,/);
  });

  it('connect captures the resume generation before starting the async flight', () => {
    const connectBody = extractUseCallbackBody(SOURCE, 'connect');
    expect(connectBody).toMatch(
      /connectInFlightRef\.current = true;\s*const generation = resumeGenerationRef\.current;\s*const reuseIfRunning = opts\?\.reuseIfRunning \?\? true;\s*const flight = \(async \(\) => \{/,
    );
  });

  it('connect skips applying a stale configured state when superseded by a newer suspend', () => {
    const connectBody = extractUseCallbackBody(SOURCE, 'connect');
    expect(connectBody).toMatch(
      /if \(resumeGenerationRef\.current !== generation\) \{[\s\S]*?return;\s*\}/,
    );
    const guardIndex = connectBody.indexOf('if (resumeGenerationRef.current !== generation)');
    const configuredIndex = connectBody.indexOf("status: 'configured'");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(configuredIndex).toBeGreaterThan(guardIndex);
  });

  it('does not gate the connect failure catch block on the resume generation (unrelated to suspend races)', () => {
    const connectBody = extractUseCallbackBody(SOURCE, 'connect');
    const catchRe = /\} catch \(e\) \{[\s\S]*?connectInFlightRef\.current = false;/;
    const catchBlock = catchRe.exec(connectBody)?.[0];
    expect(catchBlock).toBeDefined();
    expect(catchBlock).not.toContain('resumeGenerationRef');
  });

  it('keeps B1 sticky user-disconnect (suppressReconnectRef) independent of the resume generation', () => {
    const resumeRe = /const onPowerResume = useCallback\([\s\S]*?\}, \[connect\]\);/;
    const resumeBody = resumeRe.exec(SOURCE)?.[0];
    expect(resumeBody).toBeDefined();
    expect(resumeBody).toContain('suppressReconnectRef.current');
    expect(resumeBody).not.toContain('resumeGenerationRef');
  });

  it('onPowerSuspend stops the sidecar when an enabled BLE RNode is configured', () => {
    expect(SOURCE).toMatch(/powerSuspendHadBleRnodeRef/);
    expect(SOURCE).toMatch(/isReticulumBleRnodeInterfaceRow\(row\)/);
    const suspendRe = /const onPowerSuspend = useCallback\([\s\S]*?\}, \[\]\);/;
    const suspendBody = suspendRe.exec(SOURCE)?.[0];
    expect(suspendBody).toBeDefined();
    expect(suspendBody).toContain('electronAPI.reticulum.stop()');
    expect(suspendBody).toContain('powerSuspendHadBleRnodeRef.current = hadBleRnode');
  });

  it('onPowerResume forces reuseIfRunning false after BLE RNode suspend', () => {
    const resumeRe = /const onPowerResume = useCallback\([\s\S]*?\}, \[connect\]\);/;
    const resumeBody = resumeRe.exec(SOURCE)?.[0];
    expect(resumeBody).toBeDefined();
    expect(resumeBody).toContain('reuseIfRunning: !forceFresh');
    expect(resumeBody).toContain('powerSuspendHadBleRnodeRef.current');
  });

  it('latches bleBondRemoved to release Noble and set bond-desync sticky flag', () => {
    expect(SOURCE).toMatch(/setReticulumBleBondDesyncActive\(true\)/);
    expect(SOURCE).toMatch(/releaseReticulumBleRnodeConnect\(\)/);
    expect(SOURCE).toMatch(/status\.interfaceIssueAlert\?\.bleBondRemoved/);
  });

  it('wires LXMF send rekey with replacesMessageHash for pending orphan cleanup', () => {
    expect(SOURCE).toMatch(/shouldDeletePriorReticulumOutboundHash\(pendingId, hash\)/);
    expect(SOURCE).toMatch(
      /replacesMessageHash[\s\S]*?ingestReticulumLxmfPayloadWithSideEffects\([\s\S]*?replacesMessageHash/,
    );
  });
});

describe('useReticulumRuntime RMAP discovery map', () => {
  it('routes rmap.discovery WS events through setDiscovered', () => {
    expect(SOURCE).toMatch(
      /evt\.type === 'rmap\.discovery'[\s\S]*?setDiscovered\(normalizeRmapDiscoveryRows\(p\.discovered\)\)/,
    );
  });

  it('clears discovery map and peer store on disconnect and sidecar stop', () => {
    expect(SOURCE).toContain('clearReticulumSessionStores()');
    const tearDownRe =
      /const tearDownFromSidecarStop = useCallback\([\s\S]*?\}, \[syncConnectionStore\]\);/;
    const tearDownBody = tearDownRe.exec(SOURCE)?.[0];
    expect(tearDownBody).toMatch(/clearReticulumSessionStores\(\)/);
  });
});

describe('useReticulumRuntime peer refresh WS routing', () => {
  it('uses reticulumSidecarEventRefreshActions for peer vs diagnostics scheduling', () => {
    expect(SOURCE).toContain('reticulumSidecarEventRefreshActions');
    expect(SOURCE).toContain('scheduleFullPeerRefresh');
    expect(SOURCE).toMatch(
      /const refreshActions = reticulumSidecarEventRefreshActions\(evt\.type\);/,
    );
    expect(SOURCE).toMatch(/if \(refreshActions\.peers\) \{[\s\S]*?scheduleFullPeerRefresh\(\)/);
    expect(SOURCE).toMatch(
      /else if \(refreshActions\.diagnostics\) \{[\s\S]*?scheduleDebouncedDiagnosticsRefresh\(\)/,
    );
  });

  it('does not schedule full peer refresh for stats_update or interface.state inline', () => {
    expect(SOURCE).not.toMatch(/evt\.type === 'stats_update'[\s\S]{0,200}?scheduleFullPeerRefresh/);
    expect(SOURCE).not.toMatch(
      /evt\.type === 'interface\.state'[\s\S]{0,200}?scheduleFullPeerRefresh/,
    );
  });

  it('applies optimistic peer patches on announce without mandating full refresh', () => {
    expect(SOURCE).toContain('applyReticulumAnnounceReceivedOptimistic(evt.payload)');
    expect(SOURCE).toContain('applyReticulumPeersUpdatedPatches');
    expect(SOURCE).toContain('peersUpdatedRequiresFullRefresh');
    const announceBlock =
      /if \(evt\.type === 'announce\.received'\) \{[\s\S]{0,400}?requestChatOutboxDrain/.exec(
        SOURCE,
      )?.[0];
    expect(announceBlock).toBeTruthy();
    expect(announceBlock).not.toContain('scheduleFullPeerRefresh');
  });
});

describe('useReticulumRuntime contact → nodeStore label preservation', () => {
  it('wires reticulumContactToNodeRecordPreservingLabel with prior node rows', () => {
    expect(SOURCE).toContain('reticulumContactToNodeRecordPreservingLabel');
    expect(SOURCE).toMatch(
      /reticulumContactToNodeRecordPreservingLabel\(contact,\s*priorNodes\[nodeId\]\)/,
    );
    expect(SOURCE).not.toMatch(/records\.push\(reticulumContactToNodeRecord\(contact\)\)/);
  });

  it('applyContactNodesFromStore keeps History peers in nodeStore', () => {
    expect(SOURCE).toMatch(/for \(const contact of history\.values\(\)\)/);
    expect(SOURCE).toMatch(/keepNodeIds\.has\(nodeId\)/);
  });
});

describe('useReticulumRuntime chat LXMF send timeout wiring', () => {
  it('maps IPC send timeout and proxy readiness errors via shared humanize', () => {
    expect(SOURCE).toContain('withReticulumIpcSendDeadline');
    expect(SOURCE).toContain('isReticulumIpcSendTimeout');
    expect(SOURCE).toContain('reticulumProxyErrorToI18nKey');
    expect(SOURCE).toContain("i18n.t('chatPanel.reticulumSendTimeout')");
    expect(SOURCE).toMatch(/withReticulumIpcSendDeadline\(\s*[\s\S]*?proxyPost\(/);
  });
});

describe('useReticulumRuntime outbound delivery persistence', () => {
  it('persists Completes/Fails via applyReticulumOutboundDeliveryStatus', () => {
    expect(SOURCE).toMatch(
      /evt\.type === 'lxmf_outbound_status'[\s\S]*?applyReticulumOutboundDeliveryStatus\(identityId, p\.message_hash, p\.status,\s*\{\s*sentVia: p\.sent_via,\s*deliveryMethod: p\.delivery_method,\s*deliveryAttempts: p\.delivery_attempts,\s*\}\)/,
    );
  });

  it('flushes buffered early delivery status after LXMF hash rename', () => {
    expect(SOURCE).toMatch(/flushPendingReticulumOutboundDeliveryStatus\(identityId, hash\)/);
  });

  it('skips link-timeout failure bridge when PN cascade is available', () => {
    expect(SOURCE).toContain('shouldApplyLinkDeliveryTimeoutFailureBridge');
    expect(SOURCE).toMatch(
      /shouldApplyLinkDeliveryTimeoutFailureBridge\(\s*propState\.nodes,\s*propState\.preferredId,\s*\)/,
    );
    expect(SOURCE).toContain('propagationHydratedForBridgeRef');
    expect(SOURCE).toContain('identityIdRef');
    expect(SOURCE).toMatch(/if \(!applyBridge\) \{/);
    expect(SOURCE).toContain('cascade eligible');
    expect(SOURCE).toContain('propagation hydrate failed/uncertain');
    expect(SOURCE).toMatch(
      /processedLinkTimeoutDestsRef\.current\.add\(norm\);\s*failReticulumSendingOutboundToDestHash/,
    );
  });

  it('aborts link-timeout bridge after delayed hydrate when generation is stale', () => {
    expect(SOURCE).toContain('linkTimeoutBridgeGenerationRef');
    expect(SOURCE).toMatch(/const bridgeGeneration = linkTimeoutBridgeGenerationRef\.current/);
    expect(SOURCE).toContain('generation stale after hydrate');
    // Generation bumps on identity change, tearDown, and disconnect.
    const bumps = SOURCE.match(/linkTimeoutBridgeGenerationRef\.current \+= 1/g) ?? [];
    expect(bumps.length).toBeGreaterThanOrEqual(3);
  });

  it('wires propagation store + sidecar health into Reticulum diagnostics', () => {
    expect(SOURCE).toMatch(/sidecarUnhealthySince:\s*sidecarStatus\.unhealthySince/);
    expect(SOURCE).toMatch(/useReticulumPropagationStore\.subscribe/);
    expect(SOURCE).toMatch(/RETICULUM_PROPAGATION_SYNC_STALL_MS \+ 1_000/);
    expect(SOURCE).toMatch(/status\.healthy === false/);
    expect(SOURCE).toMatch(/activePropagationSyncAttemptAt/);
  });

  it('marks stale outbound with RETICULUM_STALE_OUTBOUND_MS (not a 5-minute override)', () => {
    expect(SOURCE).toContain('RETICULUM_STALE_OUTBOUND_MS');
    expect(SOURCE).toMatch(
      /markStaleReticulumOutboundMessages\(identityId, RETICULUM_STALE_OUTBOUND_MS\)/,
    );
    expect(SOURCE).toMatch(
      /markStaleReticulumOutboundInStore\(identityId, RETICULUM_STALE_OUTBOUND_MS\)/,
    );
    expect(SOURCE).not.toMatch(
      /markStaleReticulumOutboundMessages\(identityId, 5 \* MS_PER_MINUTE\)/,
    );
  });
});
