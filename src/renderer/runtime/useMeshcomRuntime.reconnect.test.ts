// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody, loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const RUNTIME_SOURCE = loadRuntimeSource('useMeshcomRuntime.ts');

describe('useMeshcomRuntime serial reconnect (regression)', () => {
  it('preserves reconnect state when preparing an auto-reconnect open', () => {
    const body = extractUseCallbackBody(RUNTIME_SOURCE, 'attemptReconnect');
    expect(body).not.toBe('');
    expect(body).toContain('prepareRfConnect(params.rfType, { preserveReconnectState: true })');
    expect(body).toContain("allowPortPicker: params.rfType === 'serial' ? false : undefined");
    expect(body).toContain('isMeshcomSerialNeedsReselectError');
    expect(body).toContain('markSerialNeedsReselectExhausted');
    expect(body).toContain('MESHCOM_RECONNECT_MAX_ATTEMPTS');
    expect(body).toContain('isReconnectingRef.current = true');
  });

  it('prepareRfConnect only resets reconnect budget when not preserving', () => {
    const body = extractUseCallbackBody(RUNTIME_SOURCE, 'prepareRfConnect');
    expect(body).not.toBe('');
    expect(body).toContain('preserveReconnectState');
    expect(body).toMatch(
      /if \(!opts\?\.preserveReconnectState\) \{[\s\S]*?rfReconnectRef\.current\.cancel\(\);[\s\S]*?reconnectAttemptRef\.current = 0;/,
    );
  });

  it('serial connectAutomatic disables the Web Serial port picker', () => {
    const body = extractUseCallbackBody(RUNTIME_SOURCE, 'connectAutomatic');
    expect(body).not.toBe('');
    expect(body).toContain('allowPortPicker: false');
    expect(body).toContain('isMeshcomSerialNeedsReselectError');
    expect(body).toContain('markSerialNeedsReselectExhausted');
  });

  it('serial watchdog pauses while a reconnect owner is active', () => {
    expect(RUNTIME_SOURCE).toContain('if (isReconnectingRef.current) return;');
    expect(RUNTIME_SOURCE).toContain('serialNeedsReselectRef');
    expect(RUNTIME_SOURCE).toContain('serialNeedsReselect: true');
  });
});
