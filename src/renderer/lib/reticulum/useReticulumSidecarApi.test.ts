// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStatus = vi.fn();
const onStatus = vi.fn();
const onEvent = vi.fn();
const onStartStack = vi.fn();

vi.mock('@/renderer/lib/appSettingsStorage', () => ({
  isReticulumAutostartEnabled: vi.fn(() => false),
  setReticulumAutostartEnabled: vi.fn(),
}));

vi.mock('@/renderer/lib/sessions/reticulumSession', () => ({
  tryGetReticulumSession: vi.fn(() => ({ connectAutomatic: vi.fn() })),
}));

import { isReticulumAutostartEnabled } from '@/renderer/lib/appSettingsStorage';
import {
  resetReticulumIdentityStoreForTests,
  useReticulumIdentityStore,
} from '@/renderer/stores/reticulumIdentityStore';

import { resetReticulumManualStackStopSuppressForTests } from './reticulumManualStackStopSuppress';
import { useReticulumSidecarApi } from './useReticulumSidecarApi';

describe('useReticulumSidecarApi', () => {
  beforeEach(() => {
    getStatus.mockReset();
    onStatus.mockReset();
    onEvent.mockReset();
    onStartStack.mockReset();
    resetReticulumManualStackStopSuppressForTests();
    vi.mocked(isReticulumAutostartEnabled).mockReturnValue(false);
    resetReticulumIdentityStoreForTests();
    onStartStack.mockResolvedValue(undefined);
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    onStatus.mockReturnValue(() => {});
    onEvent.mockReturnValue(() => {});

    window.electronAPI.reticulum.getStatus = getStatus;
    window.electronAPI.reticulum.onStatus = onStatus;
    window.electronAPI.reticulum.onEvent = onEvent;
    window.electronAPI.reticulum.proxyGet = vi.fn();
  });

  it('sidecarUiRunning follows IPC status only, not stale connection store', async () => {
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });

    const { result } = renderHook(() =>
      useReticulumSidecarApi({
        connecting: false,
        onStartStack,
      }),
    );

    await waitFor(() => {
      expect(result.current.sidecarUiRunning).toBe(false);
    });
    expect(result.current.sidecarApiReady).toBe(false);
  });

  it('sidecarApiReady is false while connecting even when sidecar is running', async () => {
    getStatus.mockResolvedValue({ running: true, port: 59477, pid: 42 });

    const { result } = renderHook(() =>
      useReticulumSidecarApi({
        connecting: true,
        onStartStack,
      }),
    );

    await waitFor(() => {
      expect(result.current.sidecarUiRunning).toBe(true);
    });
    expect(result.current.sidecarApiReady).toBe(false);
  });

  it('shares refreshed identity status across hook instances', async () => {
    getStatus.mockResolvedValue({ running: true, port: 59477, pid: 42 });
    const proxyGet = vi.fn((path: string) => {
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({
          configured: false,
          identity_hash: '',
          lxmf_hash: '',
        });
      }
      return Promise.resolve({});
    });
    window.electronAPI.reticulum.proxyGet = proxyGet;

    const first = renderHook(() =>
      useReticulumSidecarApi({
        connecting: false,
        onStartStack,
      }),
    );
    const second = renderHook(() =>
      useReticulumSidecarApi({
        connecting: false,
        onStartStack,
      }),
    );

    await waitFor(() => {
      expect(first.result.current.sidecarApiReady).toBe(true);
      expect(second.result.current.sidecarApiReady).toBe(true);
      expect(second.result.current.identity?.configured).toBe(false);
    });

    proxyGet.mockImplementation((path: string) => {
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({
          configured: true,
          identity_hash: 'identity-hash',
          lxmf_hash: 'lxmf-hash',
          display_name: 'Mesh User',
        });
      }
      return Promise.resolve({});
    });

    await act(async () => {
      await first.result.current.refreshIdentity();
    });

    expect(second.result.current.identity).toEqual({
      configured: true,
      identity_hash: 'identity-hash',
      lxmf_hash: 'lxmf-hash',
      display_name: 'Mesh User',
      public_key: null,
    });
  });

  it('does not clear shared identity while a new hook hydrates sidecar status', async () => {
    let resolveStatus:
      ((value: { running: boolean; port: number; pid: number | null }) => void) | undefined;
    getStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    window.electronAPI.reticulum.proxyGet = vi.fn((path: string) => {
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({
          configured: true,
          identity_hash: 'seeded-hash',
          lxmf_hash: 'seeded-lxmf',
        });
      }
      return Promise.resolve({});
    });

    useReticulumIdentityStore.getState().setIdentity({
      configured: true,
      identity_hash: 'seeded-hash',
      lxmf_hash: 'seeded-lxmf',
    });

    const { result } = renderHook(() =>
      useReticulumSidecarApi({
        connecting: false,
        onStartStack,
      }),
    );

    expect(result.current.identity?.identity_hash).toBe('seeded-hash');

    resolveStatus?.({ running: true, port: 59477, pid: 42 });

    await waitFor(() => {
      expect(result.current.sidecarApiReady).toBe(true);
      expect(result.current.identity?.identity_hash).toBe('seeded-hash');
    });
  });

  it('clears shared identity when sidecar stops', async () => {
    let statusHandler:
      ((status: { running: boolean; port: number; pid: number | null }) => void) | undefined;
    getStatus.mockResolvedValue({ running: true, port: 59477, pid: 42 });
    window.electronAPI.reticulum.proxyGet = vi.fn((path: string) => {
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({
          configured: true,
          identity_hash: 'identity-hash',
          lxmf_hash: 'lxmf-hash',
        });
      }
      return Promise.resolve({});
    });
    onStatus.mockImplementation((handler) => {
      statusHandler = handler;
      return () => {};
    });

    const { result } = renderHook(() =>
      useReticulumSidecarApi({
        connecting: false,
        onStartStack,
      }),
    );

    await waitFor(() => {
      expect(result.current.identity?.configured).toBe(true);
    });

    statusHandler?.({ running: false, port: 0, pid: null });

    await waitFor(() => {
      expect(result.current.identity).toBeNull();
    });
  });

  it('ignores stale identity responses after sidecar stops', async () => {
    let resolveIdentity: ((value: Record<string, unknown>) => void) | undefined;
    getStatus.mockResolvedValue({ running: true, port: 59477, pid: 42 });
    window.electronAPI.reticulum.proxyGet = vi.fn((path: string) => {
      if (path === '/api/v1/identity/status') {
        return new Promise((resolve) => {
          resolveIdentity = resolve;
        });
      }
      return Promise.resolve({});
    });

    const { result } = renderHook(() =>
      useReticulumSidecarApi({
        connecting: false,
        onStartStack,
      }),
    );

    await waitFor(() => {
      expect(result.current.sidecarApiReady).toBe(true);
    });

    const refreshPromise = act(async () => {
      await result.current.refreshIdentity();
    });

    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await act(async () => {
      await result.current.refreshSidecarStatus();
    });

    resolveIdentity?.({
      configured: true,
      identity_hash: 'stale-hash',
      lxmf_hash: 'stale-lxmf',
    });
    await refreshPromise;

    expect(useReticulumIdentityStore.getState().identity).toBeNull();
  });

  it('updates sidecarUiRunning when onStatus reports stopped', async () => {
    let statusHandler:
      ((status: { running: boolean; port: number; pid: number | null }) => void) | undefined;
    getStatus.mockResolvedValue({ running: true, port: 59477, pid: 42 });
    onStatus.mockImplementation((handler) => {
      statusHandler = handler;
      return () => {};
    });

    const { result } = renderHook(() =>
      useReticulumSidecarApi({
        connecting: false,
        onStartStack,
      }),
    );

    await waitFor(() => {
      expect(result.current.sidecarUiRunning).toBe(true);
    });

    statusHandler?.({ running: false, port: 0, pid: null });

    await waitFor(() => {
      expect(result.current.sidecarUiRunning).toBe(false);
    });
  });

  it('autostart calls onStartStack once when status flickers during in-flight start', async () => {
    vi.mocked(isReticulumAutostartEnabled).mockReturnValue(true);

    let statusHandler:
      ((status: { running: boolean; port: number; pid: number | null }) => void) | undefined;
    let resolveStart: (() => void) | undefined;
    const startPromise = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    onStartStack.mockReturnValue(startPromise);
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    onStatus.mockImplementation((handler) => {
      statusHandler = handler;
      return () => {};
    });

    renderHook(() =>
      useReticulumSidecarApi({
        connecting: false,
        enableAutostart: true,
        onStartStack,
      }),
    );

    await waitFor(() => {
      expect(onStartStack).toHaveBeenCalledTimes(1);
    });

    statusHandler?.({ running: false, port: 0, pid: null });
    statusHandler?.({ running: false, port: 0, pid: null });

    resolveStart?.();
    await waitFor(() => {
      expect(onStartStack).toHaveBeenCalledTimes(1);
    });
  });

  it('panel notifyManualStackStop suppresses AutostartCoordinator restart', async () => {
    vi.mocked(isReticulumAutostartEnabled).mockReturnValue(true);

    const statusHandlers: ((status: {
      running: boolean;
      port: number;
      pid: number | null;
    }) => void)[] = [];
    const coordinatorStart = vi.fn().mockResolvedValue(undefined);
    getStatus.mockResolvedValue({ running: true, port: 59477, pid: 42 });
    onStatus.mockImplementation((handler) => {
      statusHandlers.push(handler);
      return () => {};
    });

    const panel = renderHook(() =>
      useReticulumSidecarApi({
        connecting: false,
        enableAutostart: false,
        onStartStack,
      }),
    );
    renderHook(() =>
      useReticulumSidecarApi({
        connecting: false,
        enableAutostart: true,
        onStartStack: coordinatorStart,
      }),
    );

    await waitFor(() => {
      expect(panel.result.current.sidecarUiRunning).toBe(true);
    });
    // Ignore any mount-race autostart; the regression is restart after Stop.
    coordinatorStart.mockClear();

    act(() => {
      panel.result.current.notifyManualStackStop();
    });
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    act(() => {
      for (const handler of statusHandlers) {
        handler({ running: false, port: 0, pid: null });
      }
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(coordinatorStart).not.toHaveBeenCalled();

    // Explicit Start clears shared suppress; a later unexpected stop may autostart again.
    act(() => {
      panel.result.current.notifyManualStackStart();
    });
    act(() => {
      for (const handler of statusHandlers) {
        handler({ running: true, port: 59477, pid: 42 });
      }
    });
    coordinatorStart.mockImplementation(() => {
      getStatus.mockResolvedValue({ running: true, port: 59477, pid: 42 });
      return Promise.resolve();
    });
    act(() => {
      for (const handler of statusHandlers) {
        handler({ running: false, port: 0, pid: null });
      }
    });

    await waitFor(() => {
      expect(coordinatorStart).toHaveBeenCalled();
    });
  });
});
