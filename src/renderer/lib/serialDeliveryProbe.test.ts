import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isSerialPostWakeUntrusted,
  resetSerialDeliveryHealthForTests,
} from './serialDeliveryHealth';
import {
  beginSerialPostWakeUntrustedWindow,
  runSerialDeliveryProbe,
  serialDeadThresholdMs,
} from './serialDeliveryProbe';
import { SERIAL_DEAD_THRESHOLD_MS, SERIAL_POST_WAKE_DEAD_THRESHOLD_MS } from './serialPortRecovery';

vi.mock('../components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

vi.mock('./i18n', () => ({
  default: { t: (key: string) => key },
}));

describe('serialDeliveryProbe', () => {
  beforeEach(() => {
    resetSerialDeliveryHealthForTests();
  });

  afterEach(() => {
    resetSerialDeliveryHealthForTests();
  });

  it('returns healthy and clears post-wake untrusted on success', async () => {
    beginSerialPostWakeUntrustedWindow();
    expect(isSerialPostWakeUntrusted()).toBe(true);
    const result = await runSerialDeliveryProbe('test', () => Promise.resolve('ok'));
    expect(result).toBe('healthy');
    expect(isSerialPostWakeUntrusted()).toBe(false);
  });

  it('returns failed when probe throws', async () => {
    beginSerialPostWakeUntrustedWindow();
    const result = await runSerialDeliveryProbe('test', () => Promise.reject(new Error('boom')));
    expect(result).toBe('failed');
  });

  it('ignores success from a superseded post-wake generation', async () => {
    beginSerialPostWakeUntrustedWindow();
    const firstGenProbe = runSerialDeliveryProbe('stale', () => {
      beginSerialPostWakeUntrustedWindow();
      return Promise.resolve('ok');
    });
    const result = await firstGenProbe;
    expect(result).toBe('stale');
    expect(isSerialPostWakeUntrusted()).toBe(true);
  });

  it('uses accelerated dead threshold while post-wake untrusted', () => {
    expect(serialDeadThresholdMs(false)).toBe(SERIAL_DEAD_THRESHOLD_MS);
    expect(serialDeadThresholdMs(true)).toBe(SERIAL_POST_WAKE_DEAD_THRESHOLD_MS);
  });
});
