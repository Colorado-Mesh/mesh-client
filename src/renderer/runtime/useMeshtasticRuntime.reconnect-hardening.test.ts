// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TEST_DIR = import.meta.dirname ?? __dirname;
const SOURCE = readFileSync(join(TEST_DIR, 'useMeshtasticRuntime.ts'), 'utf-8');

/** Returns the inner text of a `{ ... }` block starting at `openBraceIndex`. */
function extractBalancedBlock(source: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openBraceIndex + 1, i);
    }
  }
  throw new Error(`Unbalanced braces at index ${openBraceIndex}`);
}

function extractIfBlockBody(source: string, condition: string): string {
  const marker = `if (${condition})`;
  const ifIndex = source.indexOf(marker);
  if (ifIndex === -1) return '';
  const braceIndex = source.indexOf('{', ifIndex);
  if (braceIndex === -1) return '';
  return extractBalancedBlock(source, braceIndex);
}

function extractUseCallbackBody(source: string, name: string): string {
  const marker = `const ${name} = useCallback(`;
  const start = source.indexOf(marker);
  if (start === -1) return '';
  const arrowIndex = source.indexOf('=> {', start);
  if (arrowIndex === -1) return '';
  const braceIndex = source.indexOf('{', arrowIndex);
  if (braceIndex === -1) return '';
  return extractBalancedBlock(source, braceIndex);
}

describe('useMeshtasticRuntime reconnect hardening (regression)', () => {
  it('uses suspend-aware delayUnlessSuspended for reconnect backoff', () => {
    expect(SOURCE).toContain('delayUnlessSuspended');
    expect(SOURCE).toMatch(/delayResult === 'suspended'/);
  });

  it('normalizes reconnect UI to disconnected when backoff aborts due to suspend', () => {
    expect(SOURCE).toMatch(
      /if \(delayResult === 'suspended'\) \{[\s\S]*?status: 'disconnected'[\s\S]*?connectionLoss: true/,
    );
  });

  it('restarts reconnect when disconnect fires during an in-flight reconnect', () => {
    expect(SOURCE).toMatch(/Connection lost during reconnect — restarting reconnect cycle/);
    expect(SOURCE).toMatch(/reconnectGenerationRef\.current \+= 1/);
  });

  it('verifies Noble BLE link after configure, not before open (disconnect must allow fresh connect)', () => {
    expect(SOURCE).toContain('verifyMeshtasticRfLink');
    expect(SOURCE).toContain('RF link lost after reconnect configure');
    expect(SOURCE).not.toContain('RF link not ready before reconnect open');
    expect(SOURCE).toMatch(/if \(type !== 'ble'\) return true/);
  });

  it('cleans up device and watchdog when reconnect budget is exhausted', () => {
    const exhaustionBlock = extractIfBlockBody(
      SOURCE,
      'reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS',
    );
    expect(exhaustionBlock.length).toBeGreaterThan(0);
    expect(exhaustionBlock).toContain('cleanupSubscriptions()');
    expect(exhaustionBlock).toContain('stopWatchdog()');
    expect(exhaustionBlock).toContain('deviceRef.current = null');
    expect(SOURCE).toContain('escalateSerialReconnectExhaustion');
    expect(SOURCE).toContain('serialNeedsReselect');
    expect(SOURCE).toContain('registerMeshtasticSerialDisconnectTarget');
  });

  it('clears reconnect refs in handleRfConnectFailure', () => {
    const failureBlock = extractUseCallbackBody(SOURCE, 'handleRfConnectFailure');
    expect(failureBlock.length).toBeGreaterThan(0);
    expect(failureBlock).toContain('isReconnectingRef.current = false');
    expect(failureBlock).toContain('reconnectGenerationRef.current += 1');
  });

  it('exports power suspend/resume handlers for usePowerRecovery', () => {
    expect(SOURCE).toContain('onPowerSuspend');
    expect(SOURCE).toContain('onPowerResume');
    expect(SOURCE).toContain('rehydrateMeshtasticConnectionParamsFromStorage');
    expect(SOURCE).toContain('handleConnectionLost safeDisconnect');
    expect(SOURCE).toContain('meshtasticExplicitDisconnectRef');
  });
});
