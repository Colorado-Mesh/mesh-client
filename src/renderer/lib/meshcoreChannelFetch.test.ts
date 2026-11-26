import { describe, expect, it, vi } from 'vitest';

import { readMeshcoreChannelsWithRetry } from './meshcoreChannelFetch';

describe('readMeshcoreChannelsWithRetry', () => {
  it('returns the first non-empty snapshot without retrying', async () => {
    const readOnce = vi.fn().mockResolvedValue([{ name: 'Public' }]);

    await expect(readMeshcoreChannelsWithRetry(readOnce, { delayMs: 0 })).resolves.toEqual([
      { name: 'Public' },
    ]);
    expect(readOnce).toHaveBeenCalledTimes(1);
  });

  it('re-reads an empty snapshot until the radio answers', async () => {
    const readOnce = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ name: 'Public' }]);

    await expect(
      readMeshcoreChannelsWithRetry(readOnce, { delayMs: 0, attempts: 3 }),
    ).resolves.toEqual([{ name: 'Public' }]);
    expect(readOnce).toHaveBeenCalledTimes(3);
  });

  it('returns the last empty snapshot once attempts are exhausted', async () => {
    const readOnce = vi.fn().mockResolvedValue([]);

    await expect(
      readMeshcoreChannelsWithRetry(readOnce, { delayMs: 0, attempts: 2 }),
    ).resolves.toEqual([]);
    expect(readOnce).toHaveBeenCalledTimes(2);
  });

  it('stops retrying when the setup is cancelled', async () => {
    const readOnce = vi.fn().mockResolvedValue([]);
    const isCancelled = vi.fn().mockReturnValue(true);

    await expect(
      readMeshcoreChannelsWithRetry(readOnce, { delayMs: 0, attempts: 3, isCancelled }),
    ).resolves.toEqual([]);
    expect(readOnce).toHaveBeenCalledTimes(1);
  });
});
