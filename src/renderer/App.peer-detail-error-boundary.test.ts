/**
 * Source contract: Reticulum peer-detail modal must be isolated in its own ErrorBoundary
 * so a React #185 / render failure cannot take down the App shell.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TEST_DIR = import.meta.dirname ?? __dirname;
const SOURCE = readFileSync(join(TEST_DIR, 'App.tsx'), 'utf-8');

describe('App ReticulumPeerDetailModal ErrorBoundary (regression)', () => {
  it('wraps ReticulumPeerDetailModal in ErrorBoundary outside the panel tree', () => {
    expect(SOURCE).toMatch(
      /hasReticulumPeerDetailModal && selectedPeerHash !== null && \(\s*<ErrorBoundary>\s*<Suspense[\s\S]*?ReticulumPeerDetailModal/,
    );
  });
});
