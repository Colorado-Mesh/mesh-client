// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumInterfaceDevicePicker } from './useReticulumInterfaceDevicePicker';

describe('useReticulumInterfaceDevicePicker', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockReset();
    vi.mocked(window.electronAPI.reticulum.proxyPost).mockReset();
    vi.mocked(window.electronAPI.bleCoexistence.acquireScan).mockReset();
    vi.mocked(window.electronAPI.bleCoexistence.releaseScan).mockReset();
    vi.mocked(window.electronAPI.bleCoexistence.acquireScan).mockResolvedValue({
      connections: [],
      scanOwner: 'reticulum',
    });
    vi.mocked(window.electronAPI.bleCoexistence.releaseScan).mockResolvedValue({
      connections: [],
      scanOwner: null,
    });
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockImplementation((path: string) => {
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: true, missing: [] });
      }
      if (path.startsWith('/api/v1/ble/scan')) {
        return Promise.resolve({
          devices: [{ address: 'AA:BB:CC:DD:EE:FF', name: 'peer-hash', kind: 'peer' }],
        });
      }
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({ interfaces: [] });
      }
      return Promise.resolve({});
    });
  });

  it('scans for BLE peers while mesh Web BT is connected (no mesh block)', async () => {
    const { result } = renderHook(() => useReticulumInterfaceDevicePicker());

    await act(async () => {
      await result.current.openPicker({
        mode: 'ble-peer',
        sidecarReady: true,
        onSelect: vi.fn(),
      });
    });

    expect(window.electronAPI.bleCoexistence.acquireScan).toHaveBeenCalledWith('reticulum');
    expect(result.current.scanError).toBeNull();
    expect(result.current.devices).toEqual([
      { address: 'AA:BB:CC:DD:EE:FF', name: 'peer-hash', kind: 'peer' },
    ]);
  });

  it('releases scan lease after scan completes', async () => {
    const { result } = renderHook(() => useReticulumInterfaceDevicePicker());

    await act(async () => {
      await result.current.openPicker({
        mode: 'ble-peer',
        sidecarReady: true,
        onSelect: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(window.electronAPI.bleCoexistence.releaseScan).toHaveBeenCalledWith('reticulum');
    });
  });

  it('surfaces scan_busy when another scan holds the lease', async () => {
    vi.mocked(window.electronAPI.bleCoexistence.acquireScan).mockRejectedValue(
      new Error('Bluetooth scan in progress (webbt)'),
    );

    const { result } = renderHook(() => useReticulumInterfaceDevicePicker());

    await act(async () => {
      await result.current.openPicker({
        mode: 'ble-peer',
        sidecarReady: true,
        onSelect: vi.fn(),
      });
    });

    expect(result.current.scanError).toBe('scan_busy');
    expect(result.current.devices).toEqual([]);
  });
});
