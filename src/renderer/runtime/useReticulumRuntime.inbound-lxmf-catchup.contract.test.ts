/**
 * Source contract: useReticulumRuntime wires catchUpRecentInboundLxmf on connect,
 * restart, WS lag/reconnect, and periodic tick — without a full runtime integration mock.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody } from '../lib/sourceContractTestHelpers';

const TEST_DIR = import.meta.dirname ?? __dirname;
const SOURCE = readFileSync(join(TEST_DIR, 'useReticulumRuntime.ts'), 'utf-8');

describe('useReticulumRuntime inbound LXMF catch-up wiring (source contract)', () => {
  it('imports catchUpRecentInboundLxmf and wraps it in a useCallback', () => {
    expect(SOURCE).toMatch(
      /import \{ catchUpRecentInboundLxmf as runInboundLxmfCatchUp \} from '@\/renderer\/lib\/reticulum\/catchUpRecentInboundLxmf'/,
    );
    expect(SOURCE).toMatch(
      /const catchUpRecentInboundLxmf = useCallback\(\s*async \(opts\?: \{ sinceTs\?: number; reason\?: string \}\) => \{/,
    );
    expect(SOURCE).toContain('await runInboundLxmfCatchUp({');
  });

  it('catches up after connect and restartStack', () => {
    const connectBody = extractUseCallbackBody(SOURCE, 'connect');
    expect(connectBody).toContain("await catchUpRecentInboundLxmf({ reason: 'connect' })");

    const restartBody = extractUseCallbackBody(SOURCE, 'restartStack');
    expect(restartBody).toContain("await catchUpRecentInboundLxmf({ reason: 'restartStack' })");
  });

  it('catches up on WS events_lagged and ws_reconnect', () => {
    expect(SOURCE).toMatch(
      /evt\.type === 'events_lagged'[\s\S]*?catchUpRecentInboundLxmf\(\{ reason: 'events_lagged' \}\)/,
    );
    expect(SOURCE).toMatch(
      /evt\.type === 'ws_connected'[\s\S]*?reconnect === true[\s\S]*?catchUpRecentInboundLxmf\(\{ reason: 'ws_reconnect' \}\)/,
    );
  });

  it('schedules periodic catch-up while the stack is active', () => {
    expect(SOURCE).toMatch(/void catchUpRecentInboundLxmf\(\{ sinceTs, reason: 'periodic' \}\)/);
    expect(SOURCE).toMatch(/RETICULUM_INBOUND_LXMF_CATCHUP_MS/);
  });
});
