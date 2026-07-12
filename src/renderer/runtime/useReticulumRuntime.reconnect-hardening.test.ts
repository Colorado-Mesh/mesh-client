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
