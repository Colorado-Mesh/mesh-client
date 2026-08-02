import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetMeshtasticTextSendPacingForTests,
  withMeshtasticTextSendPacing,
} from './meshtasticTextSendPacing';
import { MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS } from './timeConstants';

describe('withMeshtasticTextSendPacing', () => {
  beforeEach(() => {
    resetMeshtasticTextSendPacingForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetMeshtasticTextSendPacingForTests();
  });

  it('does not delay the first send', async () => {
    const send = vi.fn().mockResolvedValue('ok');
    const pending = withMeshtasticTextSendPacing(send);
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('paces a second send from completion of the first, not from start', async () => {
    // Regression: stamping before await send() let a slow first write shrink the gap
    // under firmware's 2s RATE_LIMIT_EXCEEDED window.
    const slowSend = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 800);
        }),
    );
    const second = vi.fn().mockResolvedValue(undefined);

    const firstPending = withMeshtasticTextSendPacing(slowSend);
    await vi.advanceTimersByTimeAsync(800);
    await firstPending;

    const secondPending = withMeshtasticTextSendPacing(second);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS - 100);
    expect(second).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    await secondPending;
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stamps even when send rejects so the next attempt still waits', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('radio busy'));
    const next = vi.fn().mockResolvedValue(undefined);

    const first = withMeshtasticTextSendPacing(failing);
    const firstExpectation = expect(first).rejects.toThrow('radio busy');
    await vi.advanceTimersByTimeAsync(0);
    await firstExpectation;

    const secondPending = withMeshtasticTextSendPacing(next);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS - 100);
    expect(next).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    await secondPending;
    expect(next).toHaveBeenCalledTimes(1);
  });
});
