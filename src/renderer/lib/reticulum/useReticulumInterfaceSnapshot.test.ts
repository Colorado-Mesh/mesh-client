import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getReticulumBleConnectGraceExpiresAt,
  resetReticulumBleConnectGraceForTests,
} from '@/renderer/lib/reticulum/reticulumBleConnectGrace';
import { syncReticulumNobleBleYield } from '@/renderer/lib/reticulum/reticulumNobleBleYield';
import {
  noteReticulumProxyRateLimitHit,
  resetReticulumProxyRateLimitBackoffForTests,
} from '@/renderer/lib/reticulum/reticulumProxyRateLimitBackoff';
import { invalidateReticulumInterfacesCache } from '@/renderer/lib/reticulum/reticulumSidecarReads';

import { useReticulumInterfaceSnapshot } from './useReticulumInterfaceSnapshot';

vi.mock('@/renderer/lib/reticulum/reticulumBleAdapterConflict', () => ({
  syncReticulumBleRegistry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/lib/reticulum/reticulumNobleBleYield', () => ({
  syncReticulumNobleBleYield: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/lib/reticulum/reticulumLocalInterfaceLogging', () => ({
  logReticulumLocalInterfaceHealthChanges: vi.fn(),
}));

vi.mock('@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh', () => ({
  RETICULUM_BLE_CONNECT_GRACE_MS: 60_000,
  pickReticulumLocalHealthPollMs: vi.fn().mockReturnValue(60_000),
  scheduleReticulumLocalInterfaceBurst: vi.fn().mockReturnValue(() => {}),
}));

describe('useReticulumInterfaceSnapshot', () => {
  beforeEach(() => {
    resetReticulumBleConnectGraceForTests();
    resetReticulumProxyRateLimitBackoffForTests();
    invalidateReticulumInterfacesCache();
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
      healthy: true,
    });
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockReset();
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({
          interfaces: [
            {
              id: 'if-1',
              name: 'Local RNode',
              type: 'serial',
              enabled: true,
              status: 'up',
              serial_port: '/dev/ttyUSB0',
            },
          ],
          effective_primary_local_serial_interface_id: 'if-1',
        });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [{ path: '/dev/ttyUSB0', label: 'USB Serial' }] });
      }
      return Promise.resolve({});
    });
  });

  it('clears state when sidecar is not running', () => {
    const { result } = renderHook(() =>
      useReticulumInterfaceSnapshot({ sidecarRunning: false, pollActive: true }),
    );
    expect(result.current.interfaces).toEqual([]);
    expect(result.current.serialPorts).toEqual([]);
    expect(result.current.effectivePrimaryLocalSerialInterfaceId).toBeNull();
  });

  it('loads interfaces and serial ports when sidecar becomes ready', async () => {
    const { result } = renderHook(() =>
      useReticulumInterfaceSnapshot({ sidecarRunning: true, pollActive: false }),
    );

    await waitFor(() => {
      expect(result.current.interfaces).toHaveLength(1);
    });

    expect(result.current.interfaces[0]?.id).toBe('if-1');
    expect(result.current.serialPortPaths).toEqual(['/dev/ttyUSB0']);
    expect(result.current.effectivePrimaryLocalSerialInterfaceId).toBe('if-1');
    expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith('/api/v1/interfaces');
    expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith('/api/v1/serial/ports');
  });

  it('refresh returns snapshot data', async () => {
    const { result } = renderHook(() =>
      useReticulumInterfaceSnapshot({ sidecarRunning: true, pollActive: false }),
    );

    await waitFor(() => {
      expect(result.current.interfaces).toHaveLength(1);
    });

    let snapshot: Awaited<ReturnType<typeof result.current.refresh>> | undefined;
    await act(async () => {
      snapshot = await result.current.refresh();
    });

    expect(snapshot?.interfaces).toHaveLength(1);
    expect(snapshot?.paths).toEqual(['/dev/ttyUSB0']);
  });

  it('retains interfaces while sidecar stays running (connecting gap)', async () => {
    const { result, rerender } = renderHook(
      ({ running }: { running: boolean }) =>
        useReticulumInterfaceSnapshot({ sidecarRunning: running, pollActive: running }),
      { initialProps: { running: true } },
    );

    await waitFor(() => {
      expect(result.current.interfaces).toHaveLength(1);
    });

    // Connecting clears sidecarApiReady historically, but sidecarRunning stays true —
    // do not wipe rows so BLE RNode RSSI can seed during first-start settle.
    rerender({ running: true });
    expect(result.current.interfaces).toHaveLength(1);
    expect(result.current.interfaces[0]?.id).toBe('if-1');
  });

  it('handleSidecarEvent triggers refresh on stack_restart_requested', async () => {
    const { result } = renderHook(() =>
      useReticulumInterfaceSnapshot({ sidecarRunning: true, pollActive: false }),
    );

    await waitFor(() => {
      expect(result.current.interfaces).toHaveLength(1);
    });

    const callsBefore = vi.mocked(window.electronAPI.reticulum.proxyGet).mock.calls.length;

    act(() => {
      result.current.handleSidecarEvent({ type: 'stack_restart_requested', payload: {} });
    });

    await waitFor(() => {
      expect(vi.mocked(window.electronAPI.reticulum.proxyGet).mock.calls.length).toBeGreaterThan(
        callsBefore,
      );
    });
  });

  it('handleSidecarEvent refreshes on interface.state but not announce/stats', async () => {
    const { result } = renderHook(() =>
      useReticulumInterfaceSnapshot({ sidecarRunning: true, pollActive: false }),
    );

    await waitFor(() => {
      expect(result.current.interfaces).toHaveLength(1);
    });

    const callsBefore = vi.mocked(window.electronAPI.reticulum.proxyGet).mock.calls.length;

    act(() => {
      result.current.handleSidecarEvent({ type: 'announce.received', payload: {} });
      result.current.handleSidecarEvent({ type: 'stats_update', payload: {} });
    });

    expect(vi.mocked(window.electronAPI.reticulum.proxyGet).mock.calls.length).toBe(callsBefore);

    act(() => {
      result.current.handleSidecarEvent({ type: 'interface.state', payload: {} });
    });

    await waitFor(() => {
      expect(vi.mocked(window.electronAPI.reticulum.proxyGet).mock.calls.length).toBeGreaterThan(
        callsBefore,
      );
    });
  });

  it('skips refresh while shared proxy rate-limit backoff is active', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { result } = renderHook(() =>
      useReticulumInterfaceSnapshot({ sidecarRunning: true, pollActive: false }),
    );

    await waitFor(() => {
      expect(result.current.interfaces).toHaveLength(1);
    });

    noteReticulumProxyRateLimitHit('shared');
    const callsBefore = vi.mocked(window.electronAPI.reticulum.proxyGet).mock.calls.length;

    act(() => {
      result.current.handleSidecarEvent({ type: 'interface.state', payload: {} });
    });

    // Cache invalidated, but refresh short-circuits on shared backoff.
    await act(async () => {
      await Promise.resolve();
    });
    expect(vi.mocked(window.electronAPI.reticulum.proxyGet).mock.calls.length).toBe(callsBefore);
  });
});

const BLE_RNODE_ROW = {
  id: 'ble-rnode',
  name: 'BLE RNode',
  type: 'rnode',
  enabled: true,
  status: 'down',
  serial_port: 'ble://AA:BB:CC:DD:EE:FF',
};

describe('useReticulumInterfaceSnapshot Noble BLE yield', () => {
  beforeEach(() => {
    resetReticulumBleConnectGraceForTests();
    invalidateReticulumInterfacesCache();
    vi.mocked(syncReticulumNobleBleYield).mockClear();
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
      healthy: true,
    });
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({ interfaces: [BLE_RNODE_ROW] });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [] });
      }
      return Promise.resolve({});
    });
  });

  it('does not own Noble yield sync (watcher owns lifecycle)', async () => {
    renderHook(() => useReticulumInterfaceSnapshot({ sidecarRunning: true, pollActive: false }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith('/api/v1/interfaces');
    });
    expect(syncReticulumNobleBleYield).not.toHaveBeenCalled();
  });

  it('does not release Noble yield when sidecar stops running', async () => {
    const { result, rerender } = renderHook(
      ({ running }: { running: boolean }) =>
        useReticulumInterfaceSnapshot({ sidecarRunning: running, pollActive: false }),
      { initialProps: { running: true } },
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith('/api/v1/interfaces');
    });

    const graceBefore = getReticulumBleConnectGraceExpiresAt();
    expect(graceBefore).toBeGreaterThan(Date.now());

    vi.mocked(syncReticulumNobleBleYield).mockClear();
    rerender({ running: false });

    await waitFor(() => {
      expect(result.current.interfaces).toEqual([]);
    });
    expect(syncReticulumNobleBleYield).not.toHaveBeenCalled();
    // Grace clock is owned by the watcher — snapshot must not clear it on stop.
    expect(getReticulumBleConnectGraceExpiresAt()).toBe(graceBefore);
  });
});
