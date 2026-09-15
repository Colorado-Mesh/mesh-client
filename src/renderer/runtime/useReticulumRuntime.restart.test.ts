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
