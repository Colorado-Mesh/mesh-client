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
