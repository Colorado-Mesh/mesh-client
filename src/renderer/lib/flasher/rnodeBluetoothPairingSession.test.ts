import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RNodeBluetoothPairingSession } from './rnodeBluetoothPairingSession';

describe('RNodeBluetoothPairingSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires timeout only for the current attempt', () => {
    const session = new RNodeBluetoothPairingSession({ timeoutMs: 1_000 });
    const firstTimeout = vi.fn();
    const secondTimeout = vi.fn();

    session.begin(firstTimeout);
    session.begin(secondTimeout);

    vi.advanceTimersByTime(1_000);
    expect(firstTimeout).not.toHaveBeenCalled();
    expect(secondTimeout).toHaveBeenCalledTimes(1);
  });

  it('invalidate after disable prevents a stale timeout from clearing pending', () => {
    const session = new RNodeBluetoothPairingSession({ timeoutMs: 1_000 });
    const onTimeout = vi.fn();
    const attempt = session.begin(onTimeout);

    session.invalidate();
    vi.advanceTimersByTime(1_000);

    expect(attempt.isCurrent()).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clearTimer on PIN delivery stops the pending timeout', () => {
    const session = new RNodeBluetoothPairingSession({ timeoutMs: 1_000 });
    const onTimeout = vi.fn();
    const attempt = session.begin(onTimeout);

    attempt.clearTimer();
    vi.advanceTimersByTime(1_000);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(attempt.isCurrent()).toBe(true);
  });

  it('disable then re-enable then start pairing only times out the latest attempt', () => {
    const session = new RNodeBluetoothPairingSession({ timeoutMs: 1_000 });
    const firstTimeout = vi.fn();
    const secondTimeout = vi.fn();

    session.begin(firstTimeout);
    // Disable Bluetooth mid-wait
    session.invalidate();
    // Re-enable + Start pairing again
    const latest = session.begin(secondTimeout);

    vi.advanceTimersByTime(999);
    expect(secondTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(firstTimeout).not.toHaveBeenCalled();
    expect(secondTimeout).toHaveBeenCalledTimes(1);
    expect(latest.isCurrent()).toBe(true);
  });
});
