import { describe, expect, it } from 'vitest';

import { MS_PER_MINUTE } from '@/shared/timeConstants';

import {
  shouldFireBatteryLow,
  shouldFireLinkDown,
  shouldFireSilenceAlert,
  shouldFireSilenceEscalation,
} from './operationalAlerts';

const NOW = 1_700_000_000_000;

function silence(minutesAgo: number | null, alreadyFiredForCycle = false) {
  return {
    lastHeardMs: minutesAgo === null ? null : NOW - minutesAgo * MS_PER_MINUTE,
    nowMs: NOW,
    thresholdMinutes: 30,
    alreadyFiredForCycle,
  };
}

describe('shouldFireSilenceAlert', () => {
  it('fires at and after the threshold', () => {
    expect(shouldFireSilenceAlert(silence(29))).toBe(false);
    expect(shouldFireSilenceAlert(silence(30))).toBe(true);
    expect(shouldFireSilenceAlert(silence(120))).toBe(true);
  });

  it('does not fire twice in one cycle', () => {
    expect(shouldFireSilenceAlert(silence(60, true))).toBe(false);
  });

  it('does not fire for never-heard or invalid inputs', () => {
    expect(shouldFireSilenceAlert(silence(null))).toBe(false);
    expect(shouldFireSilenceAlert({ ...silence(60), lastHeardMs: undefined })).toBe(false);
    expect(shouldFireSilenceAlert({ ...silence(60), lastHeardMs: 0 })).toBe(false);
    expect(shouldFireSilenceAlert({ ...silence(60), thresholdMinutes: 0 })).toBe(false);
    expect(shouldFireSilenceAlert({ ...silence(60), thresholdMinutes: NaN })).toBe(false);
  });

  it('treats future lastHeard as recent', () => {
    expect(shouldFireSilenceAlert(silence(-60))).toBe(false);
  });
});

describe('shouldFireSilenceEscalation', () => {
  it('fires at twice the threshold', () => {
    expect(shouldFireSilenceEscalation(silence(59))).toBe(false);
    expect(shouldFireSilenceEscalation(silence(60))).toBe(true);
    expect(shouldFireSilenceEscalation(silence(60, true))).toBe(false);
    expect(shouldFireSilenceEscalation(silence(null))).toBe(false);
  });
});

describe('shouldFireBatteryLow', () => {
  const base = { thresholdPercent: 10, protocolHasBattery: true, alreadyFiredForCycle: false };

  it('fires at or below the threshold', () => {
    expect(shouldFireBatteryLow({ ...base, batteryPercent: 10 })).toBe(true);
    expect(shouldFireBatteryLow({ ...base, batteryPercent: 3 })).toBe(true);
    expect(shouldFireBatteryLow({ ...base, batteryPercent: 11 })).toBe(false);
  });

  it('treats 0 / null / undefined / NaN as unknown', () => {
    for (const batteryPercent of [0, null, undefined, NaN]) {
      expect(shouldFireBatteryLow({ ...base, batteryPercent })).toBe(false);
    }
  });

  it('treats values above 100 as charging', () => {
    expect(shouldFireBatteryLow({ ...base, batteryPercent: 101 })).toBe(false);
  });

  it('respects protocol capability and cycle gating', () => {
    expect(shouldFireBatteryLow({ ...base, batteryPercent: 5, protocolHasBattery: false })).toBe(
      false,
    );
    expect(shouldFireBatteryLow({ ...base, batteryPercent: 5, alreadyFiredForCycle: true })).toBe(
      false,
    );
    expect(shouldFireBatteryLow({ ...base, batteryPercent: 5, thresholdPercent: 0 })).toBe(false);
  });
});

describe('shouldFireLinkDown', () => {
  const drop = {
    wasConnected: true,
    isConnected: false,
    isManualDisconnect: false,
    isReconnectInProgress: false,
  };

  it('fires only on an unexpected drop', () => {
    expect(shouldFireLinkDown(drop)).toBe(true);
  });

  it.each([
    ['never connected', { wasConnected: false }],
    ['still connected', { isConnected: true }],
    ['manual disconnect', { isManualDisconnect: true }],
    ['reconnect in progress', { isReconnectInProgress: true }],
  ])('does not fire when %s', (_label, override) => {
    expect(shouldFireLinkDown({ ...drop, ...override })).toBe(false);
  });
});
