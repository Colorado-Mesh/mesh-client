// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshtasticRuntime.ts');

describe('useMeshtasticRuntime reconnect guards (contract)', () => {
  it('skips reconnect after an explicit user disconnect', () => {
    const idx = SOURCE.indexOf('const handleConnectionLost = useCallback(() => {');
    expect(idx).toBeGreaterThan(-1);
    const body = SOURCE.slice(idx, idx + 2_500);
    const explicitIdx = body.indexOf('if (meshtasticExplicitDisconnectRef.current)');
    const bondIdx = body.indexOf('getReticulumBleBondDesyncActive()');
    const scheduleIdx = body.indexOf('meshtasticRfReconnectRef.current.onLinkLost()');
    expect(explicitIdx).toBeGreaterThan(-1);
    expect(bondIdx).toBeGreaterThan(explicitIdx);
    expect(scheduleIdx).toBeGreaterThan(bondIdx);
    const branch = body.slice(explicitIdx, bondIdx);
    expect(branch).toContain('skip reconnect (user disconnect)');
    expect(branch).toMatch(/return;/);
  });

  it('skips BLE reconnect while RNode bond recovery holds the adapter', () => {
    const idx = SOURCE.indexOf('const handleConnectionLost = useCallback(() => {');
    expect(idx).toBeGreaterThan(-1);
    const body = SOURCE.slice(idx, idx + 2_500);
    const bondIdx = body.indexOf(
      "if (connectionParamsRef.current?.type === 'ble' && getReticulumBleBondDesyncActive())",
    );
    const budgetIdx = body.indexOf('shouldSkipBleReconnectAfterExhaustion({');
    const scheduleIdx = body.indexOf('meshtasticRfReconnectRef.current.onLinkLost()');
    expect(bondIdx).toBeGreaterThan(-1);
    expect(budgetIdx).toBeGreaterThan(bondIdx);
    expect(scheduleIdx).toBeGreaterThan(budgetIdx);
    const branch = body.slice(bondIdx, budgetIdx);
    expect(branch).toContain('RNode bond recovery holds the adapter');
    expect(branch).toMatch(/return;/);
  });

  it('skips BLE reconnect after the reconnect budget is exhausted', () => {
    const idx = SOURCE.indexOf('const handleConnectionLost = useCallback(() => {');
    expect(idx).toBeGreaterThan(-1);
    const body = SOURCE.slice(idx, idx + 2_500);
    const scheduleIdx = body.indexOf('meshtasticRfReconnectRef.current.onLinkLost()');
    expect(scheduleIdx).toBeGreaterThan(-1);
    const beforeSchedule = body.slice(0, scheduleIdx).replace(/\s+/g, ' ');
    // Positive polarity: skip when the helper returns true, and only for BLE.
    expect(beforeSchedule).toMatch(
      /if\s*\(\s*connectionParamsRef\.current\?\.type\s*===\s*'ble'\s*&&\s*shouldSkipBleReconnectAfterExhaustion\s*\(/,
    );
    expect(beforeSchedule).not.toMatch(/!\s*shouldSkipBleReconnectAfterExhaustion/);
    const budgetIdx = body.indexOf('shouldSkipBleReconnectAfterExhaustion');
    expect(budgetIdx).toBeGreaterThan(-1);
    const branch = body.slice(budgetIdx, scheduleIdx);
    expect(branch.replace(/\s+/g, ' ')).toContain('skip reconnect (BLE budget exhausted)');
    expect(branch).toMatch(/return;/);
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
