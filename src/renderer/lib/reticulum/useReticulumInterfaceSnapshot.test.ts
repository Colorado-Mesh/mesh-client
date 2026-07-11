import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { syncReticulumNobleBleYield } from '@/renderer/lib/reticulum/reticulumNobleBleYield';

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
  RETICULUM_BLE_CONNECT_GRACE_MS: 30_000,
  pickReticulumLocalHealthPollMs: vi.fn().mockReturnValue(60_000),
  scheduleReticulumLocalInterfaceBurst: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  invalidateReticulumInterfacesCache: vi.fn(),
}));

describe('useReticulumInterfaceSnapshot', () => {
  beforeEach(() => {
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

  it('clears state when sidecar API is not ready', () => {
    const { result } = renderHook(() =>
      useReticulumInterfaceSnapshot({ sidecarApiReady: false, pollActive: true }),
    );
    expect(result.current.interfaces).toEqual([]);
    expect(result.current.serialPorts).toEqual([]);
    expect(result.current.effectivePrimaryLocalSerialInterfaceId).toBeNull();
  });

  it('loads interfaces and serial ports when sidecar becomes ready', async () => {
    const { result } = renderHook(() =>
      useReticulumInterfaceSnapshot({ sidecarApiReady: true, pollActive: false }),
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
      useReticulumInterfaceSnapshot({ sidecarApiReady: true, pollActive: false }),
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

  it('handleSidecarEvent triggers refresh on stack_restart_requested', async () => {
    const { result } = renderHook(() =>
      useReticulumInterfaceSnapshot({ sidecarApiReady: true, pollActive: false }),
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
    vi.mocked(syncReticulumNobleBleYield).mockClear();
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

  it('syncs Noble yield when offline BLE RNode is present', async () => {
    renderHook(() => useReticulumInterfaceSnapshot({ sidecarApiReady: true, pollActive: false }));

    await waitFor(() => {
      expect(syncReticulumNobleBleYield).toHaveBeenCalled();
    });
  });

  it('releases Noble yield on sidecar stop', async () => {
    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) =>
        useReticulumInterfaceSnapshot({ sidecarApiReady: ready, pollActive: false }),
      { initialProps: { ready: true } },
    );

    await waitFor(() => {
      expect(syncReticulumNobleBleYield).toHaveBeenCalled();
    });

    vi.mocked(syncReticulumNobleBleYield).mockClear();
    rerender({ ready: false });

    await waitFor(() => {
      expect(syncReticulumNobleBleYield).toHaveBeenCalledWith(
        expect.objectContaining({ sidecarActive: false }),
        expect.any(Object),
      );
    });
  });

  it('syncs yield when BLE RNode is already online on first poll', async () => {
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({ interfaces: [{ ...BLE_RNODE_ROW, status: 'up' }] });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [] });
      }
      return Promise.resolve({});
    });

    renderHook(() => useReticulumInterfaceSnapshot({ sidecarApiReady: true, pollActive: false }));

    await waitFor(() => {
      expect(syncReticulumNobleBleYield).toHaveBeenCalledWith(
        expect.objectContaining({
          sidecarActive: true,
          interfaces: [expect.objectContaining({ status: 'up' })],
        }),
        expect.any(Object),
      );
    });
  });
});
