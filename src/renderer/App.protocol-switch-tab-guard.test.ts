/**
 * Source contract: section-tab selections must not queue an old-protocol tab
 * index behind a pending protocol switch (tab indices are per-protocol).
 * Protocol changes themselves go through one commit helper.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TEST_DIR = import.meta.dirname ?? __dirname;
const SOURCE = readFileSync(join(TEST_DIR, 'App.tsx'), 'utf-8');

describe('App protocol-switch tab guard (regression)', () => {
  it('tracks the protocol switch as a transition', () => {
    expect(SOURCE).toContain(
      'const [protocolSwitchPending, startProtocolTransition] = useTransition();',
    );
    expect(SOURCE).toContain('startProtocolTransition(() => {');
  });

  it('ignores tab selections while a protocol switch is pending', () => {
    const start = SOURCE.indexOf('const handleTabSelect');
    expect(start).toBeGreaterThan(-1);
    const body = SOURCE.slice(start, start + 700);
    expect(body).toContain('if (protocolSwitchPending) return;');
    expect(body).toContain('setActiveTab(tabIndex)');
  });

  it('ignores nav-section selections while a protocol switch is pending', () => {
    const start = SOURCE.indexOf('const handleNavSectionSelect');
    expect(start).toBeGreaterThan(-1);
    const body = SOURCE.slice(start, start + 800);
    expect(body).toContain('if (protocolSwitchPending) return;');
    // The guard must run before the stale protocol's section resolves a tab.
    expect(body.indexOf('if (protocolSwitchPending) return;')).toBeLessThan(
      body.indexOf('setActiveTab('),
    );
  });

  it('commits protocol, storage, and diagnostics in one helper', () => {
    expect(SOURCE.match(/setProtocol\(/g)).toHaveLength(1);
    expect(SOURCE.match(/localStorage\.setItem\(MESH_PROTOCOL_STORAGE_KEY/g)).toHaveLength(1);
    expect(SOURCE.match(/clearDiagnostics\(/g)).toHaveLength(1);
    expect(SOURCE).not.toContain('resetProtocolTabVisitFlags');
    const helper = SOURCE.slice(
      SOURCE.indexOf('const scheduleProtocolCommit'),
      SOURCE.indexOf('const handleProtocolChange'),
    );
    expect(helper).toContain('if (!isCurrentProtocolSwitch(id)) return;');
    expect(helper).toContain('setProtocol(input.nextProtocol)');
    expect(helper).toContain('if (input.protocolChanged)');
    expect(helper.indexOf('if (input.protocolChanged)')).toBeLessThan(
      helper.indexOf('clearDiagnostics('),
    );
  });

  it('ignores send and connect until the protocol switch commits', () => {
    const send = SOURCE.slice(
      SOURCE.indexOf('const handleSend'),
      SOURCE.indexOf('const { status: takStatus'),
    );
    expect(send).toContain('if (protocolSwitchPending) return;');
    const resend = SOURCE.slice(
      SOURCE.indexOf('const handleResend'),
      SOURCE.indexOf('const traceRouteHops'),
    );
    expect(resend).toContain('if (protocolSwitchPending) return;');
    const reconnect = SOURCE.slice(
      SOURCE.indexOf('const handleReconnect'),
      SOURCE.indexOf('const handleMessageNode'),
    );
    expect(reconnect).toContain('if (protocolSwitchPending) return;');
    expect(SOURCE).toContain(
      'protocolSwitchPending\n                                  ? ignoreProtocolSwitchConnect',
    );
    expect(SOURCE).toContain(
      'protocolSwitchPending\n                                  ? ignoreProtocolSwitchAutoConnect',
    );
  });

  it('cancels an in-flight protocol switch when re-selecting the active protocol', () => {
    const start = SOURCE.indexOf('const handleProtocolChange');
    expect(start).toBeGreaterThan(-1);
    const end = SOURCE.indexOf('const handleTabSelect', start);
    const body = SOURCE.slice(start, end > start ? end : start + 8000);
    expect(body).toContain('if (newProtocol === pendingProtocolSelection) return;');
    const sameProtocolBranch = body.indexOf('if (newProtocol === protocol)');
    expect(sameProtocolBranch).toBeGreaterThan(-1);
    const nextSibling = body.indexOf('\n      const savedPanel', sameProtocolBranch);
    const branch = body.slice(sameProtocolBranch, nextSibling);
    expect(branch).toContain('if (pendingProtocolSelection == null) return;');
    expect(branch).toContain('pending: null');
    expect(branch).toContain('protocolChanged: false');
    expect(branch).toContain('scheduleProtocolCommit(');
  });
});
