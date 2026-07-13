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

import { isReticulumAutostartEnabled } from '@/renderer/lib/appSettingsStorage';
import { resetReticulumIdentityStoreForTests } from '@/renderer/stores/reticulumIdentityStore';

import { useReticulumSidecarApi } from './useReticulumSidecarApi';

describe('useReticulumSidecarApi', () => {
  beforeEach(() => {
    getStatus.mockReset();
    onStatus.mockReset();
    onEvent.mockReset();
    onStartStack.mockReset();
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
    });
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
});
