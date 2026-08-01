import { describe, expect, it } from 'vitest';

import {
  formatNomadPageCountdown,
  nomadPageLoadingBudgetSec,
  nomadPageLoadingRemainingSec,
} from './nomadPageViewerStore';

describe('nomadPageViewerStore countdown helpers', () => {
  it('defaults to TCP MeshChat budget (not RF) when egress is unknown', () => {
    expect(nomadPageLoadingBudgetSec(1)).toBe(45);
    expect(nomadPageLoadingBudgetSec(8)).toBe(45);
    expect(nomadPageLoadingBudgetSec(3, 'network')).toBe(45);
  });

  it('uses RF budget only when egress is explicitly rf/ble', () => {
    expect(nomadPageLoadingBudgetSec(1, 'rf')).toBe(99);
    expect(nomadPageLoadingBudgetSec(6, 'ble')).toBe(99);
    expect(nomadPageLoadingBudgetSec(3, 'tcp')).toBe(45);
  });

  it('counts down remaining seconds from startedAt', () => {
    const startedAt = 1_000_000;
    expect(nomadPageLoadingRemainingSec(startedAt, 99, startedAt + 10_000)).toBe(89);
    expect(nomadPageLoadingRemainingSec(startedAt, 99, startedAt + 200_000)).toBe(0);
  });

  it('formats countdown as m:ss', () => {
    expect(formatNomadPageCountdown(99)).toBe('1:39');
    expect(formatNomadPageCountdown(5)).toBe('0:05');
    expect(formatNomadPageCountdown(0)).toBe('0:00');
  });
});
