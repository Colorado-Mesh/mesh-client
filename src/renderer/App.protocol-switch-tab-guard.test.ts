/**
 * Source contract: section-tab selections must not queue an old-protocol tab
 * index behind a pending protocol switch (tab indices are per-protocol).
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

  it('clears keep-alive visit flags inside the protocol transition (not only in useEffect)', () => {
    const start = SOURCE.indexOf('const handleProtocolChange');
    expect(start).toBeGreaterThan(-1);
    const end = SOURCE.indexOf('const handleTabSelect', start);
    const body = SOURCE.slice(start, end > start ? end : start + 8000);
    expect(body).toContain('resetProtocolTabVisitFlags()');
    expect(body.indexOf('resetProtocolTabVisitFlags()')).toBeLessThan(
      body.lastIndexOf('setProtocol(newProtocol)'),
    );
    expect(body).toContain('setPendingProtocolSelection(newProtocol)');
  });
});
