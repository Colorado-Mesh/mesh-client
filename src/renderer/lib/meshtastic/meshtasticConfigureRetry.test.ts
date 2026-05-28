import type { MeshDevice } from '@meshtastic/core';
import { describe, expect, it, vi } from 'vitest';

import {
  configureMeshtasticDeviceWithRetry,
  isMeshtasticConfigureRetryableError,
} from './meshtasticConfigureRetry';

describe('configureMeshtasticDeviceWithRetry', () => {
  it('retries on Packet does not exist then succeeds', async () => {
    vi.useFakeTimers();
    const configure = vi
      .fn<MeshDevice['configure']>()
      .mockRejectedValueOnce(new Error('Packet does not exist'))
      .mockRejectedValueOnce(new Error('Packet does not exist'))
      .mockResolvedValue(0);
    const device = { configure } as unknown as MeshDevice;

    const promise = configureMeshtasticDeviceWithRetry(device, { logTag: 'test' });
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await promise;

    expect(configure).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not retry non-retryable configure errors', async () => {
    const configure = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const device = { configure } as unknown as MeshDevice;

    await expect(configureMeshtasticDeviceWithRetry(device)).rejects.toThrow('Permission denied');
    expect(configure).toHaveBeenCalledTimes(1);
  });

  it('isMeshtasticConfigureRetryableError matches SDK message', () => {
    expect(isMeshtasticConfigureRetryableError(new Error('Packet does not exist'))).toBe(true);
    expect(isMeshtasticConfigureRetryableError(new Error('other'))).toBe(false);
  });
});
