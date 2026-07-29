import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginReticulumBleConnectGrace,
  clearReticulumBleConnectGrace,
  getReticulumBleConnectGraceExpiresAt,
  resetReticulumBleConnectGraceForTests,
  subscribeReticulumBleConnectGrace,
} from './reticulumBleConnectGrace';
import { RETICULUM_BLE_CONNECT_GRACE_MS } from './reticulumLocalInterfaceRefresh';

afterEach(() => {
  resetReticulumBleConnectGraceForTests();
});

describe('reticulumBleConnectGrace', () => {
  it('begin sets expiry grace ms ahead and notifies subscribers', () => {
    const listener = vi.fn();
    subscribeReticulumBleConnectGrace(listener);
    const now = 1_000_000;
    const expires = beginReticulumBleConnectGrace(now);
    expect(expires).toBe(now + RETICULUM_BLE_CONNECT_GRACE_MS);
    expect(getReticulumBleConnectGraceExpiresAt()).toBe(expires);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clear zeroes expiry and notifies', () => {
    beginReticulumBleConnectGrace(1_000);
    const listener = vi.fn();
    subscribeReticulumBleConnectGrace(listener);
    clearReticulumBleConnectGrace();
    expect(getReticulumBleConnectGraceExpiresAt()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
