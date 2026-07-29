// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETICULUM_LOCAL_HEALTH_FAST_POLL_MS } from '@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh';
import { useReticulumNobleBleYieldWatcher } from '@/renderer/lib/reticulum/useReticulumNobleBleYieldWatcher';

const { fetchReticulumInterfacesMock, syncReticulumNobleBleYieldMock } = vi.hoisted(() => ({
  fetchReticulumInterfacesMock: vi.fn(),
  syncReticulumNobleBleYieldMock: vi.fn(),
}));

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  fetchReticulumInterfaces: fetchReticulumInterfacesMock,
}));

vi.mock('@/renderer/lib/reticulum/reticulumNobleBleYield', () => ({
  syncReticulumNobleBleYield: syncReticulumNobleBleYieldMock,
}));

describe('useReticulumNobleBleYieldWatcher lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchReticulumInterfacesMock.mockReset().mockResolvedValue([]);
    syncReticulumNobleBleYieldMock.mockReset().mockResolvedValue(undefined);
    Object.assign(window, {
      electronAPI: {
        bleCoexistence: {
          getState: vi.fn().mockResolvedValue({ connections: [], scanOwner: null }),
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not poll interfaces while the sidecar is inactive', async () => {
    renderHook(() => {
      useReticulumNobleBleYieldWatcher(false);
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchReticulumInterfacesMock).not.toHaveBeenCalled();
    expect(syncReticulumNobleBleYieldMock).toHaveBeenCalledWith(
      expect.objectContaining({ sidecarActive: false, bleConnectGraceExpiresAt: 0 }),
      expect.anything(),
    );
  });

  it('starts polling interfaces once the sidecar becomes active', async () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        useReticulumNobleBleYieldWatcher(active);
      },
      { initialProps: { active: false } },
    );
    await vi.advanceTimersByTimeAsync(0);
    syncReticulumNobleBleYieldMock.mockClear();
    fetchReticulumInterfacesMock.mockClear();

    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);

    // The grace-expiry state update (and useNowMs's own layout-effect tick) can cascade into
    // more than one poll tick before settling — assert "polling started", not an exact count.
    expect(fetchReticulumInterfacesMock).toHaveBeenCalled();
    expect(syncReticulumNobleBleYieldMock).toHaveBeenCalledWith(
      expect.objectContaining({ sidecarActive: true }),
      expect.anything(),
    );
    const lastCallArg = syncReticulumNobleBleYieldMock.mock.calls.at(-1)?.[0];
    expect(lastCallArg.bleConnectGraceExpiresAt).toBeGreaterThan(0);
  });

  it('re-ticks on the fast health poll interval while active', async () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        useReticulumNobleBleYieldWatcher(active);
      },
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    fetchReticulumInterfacesMock.mockClear();

    await vi.advanceTimersByTimeAsync(RETICULUM_LOCAL_HEALTH_FAST_POLL_MS);
    const callsAfterFirstInterval = fetchReticulumInterfacesMock.mock.calls.length;
    expect(callsAfterFirstInterval).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(RETICULUM_LOCAL_HEALTH_FAST_POLL_MS);
    expect(fetchReticulumInterfacesMock.mock.calls.length).toBeGreaterThan(callsAfterFirstInterval);
  });

  it('stops polling and releases yield when the sidecar becomes inactive again', async () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        useReticulumNobleBleYieldWatcher(active);
      },
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    syncReticulumNobleBleYieldMock.mockClear();
    fetchReticulumInterfacesMock.mockClear();

    rerender({ active: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(syncReticulumNobleBleYieldMock).toHaveBeenCalledWith(
      expect.objectContaining({ sidecarActive: false, bleConnectGraceExpiresAt: 0 }),
      expect.anything(),
    );

    fetchReticulumInterfacesMock.mockClear();
    await vi.advanceTimersByTimeAsync(RETICULUM_LOCAL_HEALTH_FAST_POLL_MS * 2);
    expect(fetchReticulumInterfacesMock).not.toHaveBeenCalled();
  });

  it('clears the poll interval on unmount', async () => {
    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => {
        useReticulumNobleBleYieldWatcher(active);
      },
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    fetchReticulumInterfacesMock.mockClear();

    unmount();
    await vi.advanceTimersByTimeAsync(RETICULUM_LOCAL_HEALTH_FAST_POLL_MS * 3);
    expect(fetchReticulumInterfacesMock).not.toHaveBeenCalled();
  });

  it('renews grace when reticulum re-holds scan after yield already released', async () => {
    const getState = vi.fn().mockResolvedValue({ connections: [], scanOwner: null });
    Object.assign(window, {
      electronAPI: {
        bleCoexistence: { getState },
      },
    });
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        useReticulumNobleBleYieldWatcher(active);
      },
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    const firstGrace = syncReticulumNobleBleYieldMock.mock.calls.at(-1)?.[0]
      ?.bleConnectGraceExpiresAt as number;
    expect(firstGrace).toBeGreaterThan(0);

    // Simulate: grace expired, yield released (inactive), main re-suspended for stack restart.
    const stateArg = syncReticulumNobleBleYieldMock.mock.calls.at(-1)?.[1] as {
      yieldActive: boolean;
    };
    stateArg.yieldActive = false;
    getState.mockResolvedValue({ connections: [], scanOwner: 'reticulum' });
    vi.setSystemTime(firstGrace + 1_000);
    syncReticulumNobleBleYieldMock.mockClear();
    await vi.advanceTimersByTimeAsync(RETICULUM_LOCAL_HEALTH_FAST_POLL_MS);

    const renewed = syncReticulumNobleBleYieldMock.mock.calls.at(-1)?.[0]
      ?.bleConnectGraceExpiresAt as number;
    expect(renewed).toBeGreaterThan(firstGrace);
  });

  it('does not renew grace while yield is still active after grace expires', async () => {
    const getState = vi.fn().mockResolvedValue({ connections: [], scanOwner: 'reticulum' });
    Object.assign(window, {
      electronAPI: {
        bleCoexistence: { getState },
      },
    });
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        useReticulumNobleBleYieldWatcher(active);
      },
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    const firstGrace = syncReticulumNobleBleYieldMock.mock.calls.at(-1)?.[0]
      ?.bleConnectGraceExpiresAt as number;
    const stateArg = syncReticulumNobleBleYieldMock.mock.calls.at(-1)?.[1] as {
      yieldActive: boolean;
    };
    stateArg.yieldActive = true;

    vi.setSystemTime(firstGrace + 1_000);
    syncReticulumNobleBleYieldMock.mockClear();
    await vi.advanceTimersByTimeAsync(RETICULUM_LOCAL_HEALTH_FAST_POLL_MS);

    const nextGrace = syncReticulumNobleBleYieldMock.mock.calls.at(-1)?.[0]
      ?.bleConnectGraceExpiresAt as number;
    // Still the stale/expired grace — sync owns release; watcher must not extend.
    expect(nextGrace).toBe(firstGrace);
  });

  it('shares one persistent yield-state ref across re-ticks (not reset per tick)', async () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        useReticulumNobleBleYieldWatcher(active);
      },
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    const firstState = syncReticulumNobleBleYieldMock.mock.calls[0]?.[1];

    await vi.advanceTimersByTimeAsync(RETICULUM_LOCAL_HEALTH_FAST_POLL_MS);
    const secondState = syncReticulumNobleBleYieldMock.mock.calls.at(-1)?.[1];

    expect(secondState).toBe(firstState);
  });
});
