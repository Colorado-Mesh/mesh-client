import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReticulumRawPacketPoll } from '@/renderer/lib/reticulum/useReticulumRawPacketPoll';

describe('useReticulumRawPacketPoll', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not poll when inactive', () => {
    const hydrate = vi.fn().mockResolvedValue(undefined);
    renderHook(() => {
      useReticulumRawPacketPoll({
        pollActive: false,
        hydrateRawPackets: hydrate,
        intervalMs: 100,
      });
    });
    expect(hydrate).not.toHaveBeenCalled();
  });

  it('polls while active and stops on unmount', async () => {
    vi.useFakeTimers();
    const hydrate = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => {
      useReticulumRawPacketPoll({
        pollActive: true,
        hydrateRawPackets: hydrate,
        intervalMs: 100,
      });
    });

    await vi.runOnlyPendingTimersAsync();
    expect(hydrate.mock.calls.length).toBeGreaterThanOrEqual(1);
    const afterFirst = hydrate.mock.calls.length;

    await vi.advanceTimersByTimeAsync(100);
    expect(hydrate.mock.calls.length).toBeGreaterThan(afterFirst);

    unmount();
    const afterUnmount = hydrate.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300);
    expect(hydrate.mock.calls.length).toBe(afterUnmount);
  });
});
