// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshtasticRuntime.ts');

describe('useMeshtasticRuntime reconnect guards (contract)', () => {
  it('skips reconnect after an explicit user disconnect', () => {
    const idx = SOURCE.indexOf('const handleConnectionLost = useCallback(() => {');
    expect(idx).toBeGreaterThan(-1);
    const body = SOURCE.slice(idx, idx + 2_500);
    expect(body).toContain('meshtasticExplicitDisconnectRef.current');
    expect(body).toContain('skip reconnect (user disconnect)');
    const explicitIdx = body.indexOf('if (meshtasticExplicitDisconnectRef.current)');
    const scheduleIdx = body.indexOf('meshtasticRfReconnectRef.current.onLinkLost()');
    expect(explicitIdx).toBeGreaterThan(-1);
    expect(scheduleIdx).toBeGreaterThan(explicitIdx);
  });

  it('skips BLE reconnect while RNode bond recovery holds the adapter', () => {
    const idx = SOURCE.indexOf('const handleConnectionLost = useCallback(() => {');
    expect(idx).toBeGreaterThan(-1);
    const body = SOURCE.slice(idx, idx + 2_500);
    expect(body).toContain('getReticulumBleBondDesyncActive()');
    expect(body).toContain('RNode bond recovery holds the adapter');
  });

  it('skips BLE reconnect after the reconnect budget is exhausted', () => {
    const idx = SOURCE.indexOf('const handleConnectionLost = useCallback(() => {');
    expect(idx).toBeGreaterThan(-1);
    const body = SOURCE.slice(idx, idx + 2_500);
    expect(body).toContain('shouldSkipBleReconnectAfterExhaustion({');
    expect(body).toContain('skip reconnect (BLE budget exhausted)');
  });

  it('dirties the reconnect owner without double-scheduling while a cycle is active', () => {
    const idx = SOURCE.indexOf('const handleConnectionLost = useCallback(() => {');
    expect(idx).toBeGreaterThan(-1);
    const body = SOURCE.slice(idx, idx + 3_500);
    expect(body).toContain('onLinkLost()');
    expect(body).toContain('shouldStartOwner');
    expect(body).toContain('meshtasticDeferredReconnectRef.current = true');
  });
});
