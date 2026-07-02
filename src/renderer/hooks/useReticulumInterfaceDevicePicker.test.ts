// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setConnection, useConnectionStore } from '@/renderer/stores/connectionStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';

import { useReticulumInterfaceDevicePicker } from './useReticulumInterfaceDevicePicker';

describe('useReticulumInterfaceDevicePicker', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockReset();
    vi.mocked(window.electronAPI.reticulum.proxyPost).mockReset();
    vi.mocked(window.electronAPI.bleAdapter.acquire).mockReset();
    vi.mocked(window.electronAPI.bleAdapter.release).mockReset();
    vi.mocked(window.electronAPI.bleAdapter.acquire).mockResolvedValue({
      owner: 'reticulum-sidecar',
    });
    vi.mocked(window.electronAPI.bleAdapter.release).mockResolvedValue({ owner: null });
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

  it('does not acquire BLE adapter when Meshtastic is configured over BLE', async () => {
    useIdentityStore.setState({
      identities: {
        mt: {
          id: 'mt',
          protocol: { type: 'meshtastic' } as never,
          signature: '1',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
      },
      activeIdentityId: 'mt',
    });
    setConnection('mt', {
      status: 'configured',
      connectionType: 'ble',
      mqttStatus: 'disconnected',
      reconnectAttempt: 0,
      myNodeNum: 1,
    });

    const { result } = renderHook(() => useReticulumInterfaceDevicePicker());

    await act(async () => {
      await result.current.openPicker({
        mode: 'ble-peer',
        sidecarReady: true,
        onSelect: vi.fn(),
      });
    });

    expect(window.electronAPI.bleAdapter.acquire).not.toHaveBeenCalled();
    expect(result.current.scanError).toBe('mesh_ble_active');
    expect(result.current.devices).toEqual([]);
  });

  it('releases BLE adapter after scan completes', async () => {
    const { result } = renderHook(() => useReticulumInterfaceDevicePicker());

    await act(async () => {
      await result.current.openPicker({
        mode: 'ble-peer',
        sidecarReady: true,
        onSelect: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(result.current.scanning).toBe(false);
    });

    expect(window.electronAPI.bleAdapter.acquire).toHaveBeenCalled();
    expect(window.electronAPI.bleAdapter.release).toHaveBeenCalled();
    expect(result.current.devices).toHaveLength(1);
  });
});
