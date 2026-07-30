import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { persistDbWrite } from './dbPersistRetry';

describe('persistDbWrite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not queue when the write succeeds', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    persistDbWrite('ok write', write);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('retries a failed write then warns when exhausted', async () => {
    const write = vi.fn().mockRejectedValue(new Error('disk full'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    persistDbWrite('fail write', write);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);

    // attempt 0
    await vi.advanceTimersByTimeAsync(1_000);
    expect(write).toHaveBeenCalledTimes(2);

    // attempt 1
    await vi.advanceTimersByTimeAsync(1_000);
    expect(write).toHaveBeenCalledTimes(3);

    // attempt 2 exhausted → warn
    await vi.advanceTimersByTimeAsync(1_000);
    expect(write).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('degraded persistence'));
  });
});
