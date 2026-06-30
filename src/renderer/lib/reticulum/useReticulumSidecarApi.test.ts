// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStatus = vi.fn();
const onStatus = vi.fn();
const onEvent = vi.fn();
const onStartStack = vi.fn();

vi.mock('@/renderer/lib/appSettingsStorage', () => ({
  isReticulumAutostartEnabled: () => false,
  setReticulumAutostartEnabled: vi.fn(),
}));

import { useReticulumSidecarApi } from './useReticulumSidecarApi';

describe('useReticulumSidecarApi', () => {
  beforeEach(() => {
    getStatus.mockReset();
    onStatus.mockReset();
    onEvent.mockReset();
    onStartStack.mockReset();
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
});
