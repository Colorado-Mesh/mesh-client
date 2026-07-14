// @vitest-environment jsdom
/**
 * Source contract tests for useReticulumRuntime sidecar reconnect hardening.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TEST_DIR = import.meta.dirname ?? __dirname;
const SOURCE = readFileSync(join(TEST_DIR, 'useReticulumRuntime.ts'), 'utf-8');

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
    const suppressIndex = disconnectBody!.indexOf('suppressReconnectRef.current = true');
    const stopIndex = disconnectBody!.indexOf('reticulum.stop()');
    expect(suppressIndex).toBeGreaterThanOrEqual(0);
    expect(stopIndex).toBeGreaterThan(suppressIndex);
  });

  it('sidecar stop autostart reconnect respects suppressReconnect', () => {
    expect(SOURCE).toMatch(/isReticulumAutostartEnabled\(\) && !suppressReconnectRef\.current/);
  });

  it('onPowerResume skips reconnect after explicit user disconnect', () => {
    const resumeRe = /const onPowerResume = useCallback\([\s\S]*?\}, \[connect\]\);/;
    const resumeBody = resumeRe.exec(SOURCE)?.[0];
    expect(resumeBody).toBeDefined();
    expect(resumeBody).toMatch(
      /suppressReconnectRef\.current[\s\S]*?skip reconnect \(user disconnect\)/,
    );
  });
});

describe('useReticulumRuntime RMAP discovery map', () => {
  it('routes rmap.discovery WS events through setDiscovered', () => {
    expect(SOURCE).toMatch(/evt\.type === 'rmap\.discovery'[\s\S]*?setDiscovered\(p\.discovered\)/);
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

describe('useReticulumRuntime outbound delivery persistence', () => {
  it('persists Completes/Fails via applyReticulumOutboundDeliveryStatus', () => {
    expect(SOURCE).toMatch(
      /evt\.type === 'lxmf_outbound_status'[\s\S]*?applyReticulumOutboundDeliveryStatus\(identityId, p\.message_hash, p\.status,\s*\{\s*sentVia: p\.sent_via,\s*\}\)/,
    );
  });

  it('flushes buffered early delivery status after LXMF hash rename', () => {
    expect(SOURCE).toMatch(/flushPendingReticulumOutboundDeliveryStatus\(identityId, hash\)/);
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
