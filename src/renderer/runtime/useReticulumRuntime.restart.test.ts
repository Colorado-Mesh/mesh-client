// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetReticulumManualStackStopSuppressForTests } from '@/renderer/lib/reticulum/reticulumManualStackStopSuppress';
import { useReticulumRuntime } from '@/renderer/runtime/useReticulumRuntime';
import type * as ReticulumPeerStoreModule from '@/renderer/stores/reticulumPeerStore';
import { refreshReticulumPeersFromSidecar } from '@/renderer/stores/reticulumPeerStore';

type HydratedContacts = Awaited<ReturnType<typeof refreshReticulumPeersFromSidecar>>;

vi.mock('@/renderer/stores/reticulumPeerStore', async (importOriginal) => ({
  ...(await importOriginal<typeof ReticulumPeerStoreModule>()),
  refreshReticulumPeersFromSidecar: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/renderer/lib/reticulum/fetchRecentInboundLxmf', () => ({
  fetchRecentInboundLxmfDetailed: vi.fn().mockResolvedValue({ messages: [], ringLen: 0 }),
}));

vi.mock('@/renderer/lib/reticulum/useReticulumPropagationAutoSync', () => ({
  useReticulumPropagationAutoSync: () => {},
}));

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
  useToast: () => ({ addToast: vi.fn() }),
}));

describe('useReticulumRuntime soft restart cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReticulumManualStackStopSuppressForTests();
    vi.mocked(refreshReticulumPeersFromSidecar).mockResolvedValue([]);
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: false,
      port: 0,
      pid: null,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    resetReticulumManualStackStopSuppressForTests();
    vi.restoreAllMocks();
  });

  it.each(['resolve', 'reject'] as const)(
    'keeps Stop authoritative when delayed restart hydration later %s',
    async (outcome) => {
      let finishHydration!: () => void;
      let failHydration!: (error: Error) => void;
      vi.mocked(refreshReticulumPeersFromSidecar).mockImplementationOnce(
        () =>
          new Promise<HydratedContacts>((resolve, reject) => {
            finishHydration = () => {
              resolve([]);
            };
            failHydration = reject;
          }),
      );
      const { result, unmount } = renderHook(() => useReticulumRuntime());
      let restart!: Promise<void>;
      act(() => {
        restart = result.current.restartStack!();
      });
      await waitFor(() => {
        expect(finishHydration).toBeTypeOf('function');
      });
      await act(async () => {
        await result.current.disconnect();
      });
      expect(result.current.state.status).toBe('disconnected');
      vi.mocked(window.electronAPI.reticulum.proxyGet).mockClear();

      await act(async () => {
        if (outcome === 'resolve') finishHydration();
        else failHydration(new Error('sidecar stopped during hydration'));
        await restart;
      });

      expect(result.current.state.status).toBe('disconnected');
      expect(window.electronAPI.reticulum.proxyGet).not.toHaveBeenCalled();
      act(() => {
        result.current.onPowerResume?.();
      });
      expect(console.debug).toHaveBeenCalledWith(
        '[useReticulumRuntime] power resume — skip reconnect (user disconnect)',
      );
      unmount();
    },
  );

  it('cancels a queued restart when Stop supersedes its in-flight connect', async () => {
    let finishStart!: () => void;
    vi.mocked(window.electronAPI.reticulum.start).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStart = () => {
            resolve({ running: true, port: 1234, pid: 1 });
          };
        }),
    );
    const { result, unmount } = renderHook(() => useReticulumRuntime());
    let connecting!: Promise<void>;
    let restarting!: Promise<void>;
    act(() => {
      connecting = result.current.connect();
      restarting = result.current.restartStack!();
    });
    await act(async () => {
      await result.current.disconnect();
      finishStart();
      await Promise.all([connecting, restarting]);
    });

    expect(window.electronAPI.reticulum.proxyPost).not.toHaveBeenCalledWith(
      '/api/v1/stack/restart',
      {},
    );
    expect(result.current.state.status).toBe('disconnected');
    unmount();
  });

  function deferHydration(): { finish: () => void } {
    const handle = { finish: () => {} };
    vi.mocked(refreshReticulumPeersFromSidecar).mockImplementationOnce(
      () =>
        new Promise<HydratedContacts>((resolve) => {
          handle.finish = () => {
            resolve([]);
          };
        }),
    );
    return handle;
  }

  function softRestartPostCount(): number {
    return vi
      .mocked(window.electronAPI.reticulum.proxyPost)
      .mock.calls.filter(([path]) => path === '/api/v1/stack/restart').length;
  }

  it('shares one soft restart between same-generation callers', async () => {
    const first = deferHydration();
    const { result, unmount } = renderHook(() => useReticulumRuntime());
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = result.current.restartStack!();
      b = result.current.restartStack!();
    });
    await waitFor(() => {
      expect(softRestartPostCount()).toBe(1);
    });
    await act(async () => {
      first.finish();
      await Promise.all([a, b]);
    });
    expect(softRestartPostCount()).toBe(1);
    expect(result.current.state.status).toBe('configured');
    unmount();
  });

  it('starts a new-generation restart after the old flight and keeps it joinable', async () => {
    const oldFlight = deferHydration();
    const newFlight = deferHydration();
    const { result, unmount } = renderHook(() => useReticulumRuntime());
    let oldRestart!: Promise<void>;
    act(() => {
      oldRestart = result.current.restartStack!();
    });
    await waitFor(() => {
      expect(softRestartPostCount()).toBe(1);
    });

    let newRestart!: Promise<void>;
    act(() => {
      result.current.onPowerSuspend?.();
      newRestart = result.current.restartStack!();
    });
    // The new restart must wait for the old flight instead of joining or racing it.
    await act(async () => {
      await Promise.resolve();
    });
    expect(softRestartPostCount()).toBe(1);

    await act(async () => {
      oldFlight.finish();
      await oldRestart;
    });
    await waitFor(() => {
      expect(softRestartPostCount()).toBe(2);
    });

    // Settling the old flight must not have cleared the newer entry: a same-generation caller joins it.
    let joined!: Promise<void>;
    act(() => {
      joined = result.current.restartStack!();
    });
    await act(async () => {
      newFlight.finish();
      await Promise.all([newRestart, joined]);
    });
    expect(softRestartPostCount()).toBe(2);
    expect(result.current.state.status).toBe('configured');
    unmount();
  });

  it('discards suspended hydration and allows the later power-resume connect', async () => {
    let finishHydration!: () => void;
    vi.mocked(refreshReticulumPeersFromSidecar).mockImplementationOnce(
      () =>
        new Promise<HydratedContacts>((resolve) => {
          finishHydration = () => {
            resolve([]);
          };
        }),
    );
    const { result, unmount } = renderHook(() => useReticulumRuntime());
    let restart!: Promise<void>;
    act(() => {
      restart = result.current.restartStack!();
    });
    await waitFor(() => {
      expect(finishHydration).toBeTypeOf('function');
    });
    await act(async () => {
      result.current.onPowerSuspend?.();
      finishHydration();
      await restart;
    });
    expect(result.current.state.status).not.toBe('configured');

    act(() => {
      result.current.onPowerResume?.();
    });
    await waitFor(() => {
      expect(window.electronAPI.reticulum.start).toHaveBeenCalled();
      expect(result.current.state.status).toBe('configured');
    });
    unmount();
  });
});
