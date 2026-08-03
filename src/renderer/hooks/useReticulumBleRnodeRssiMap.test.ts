import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  rssiForReticulumBleRnodeRow,
  useReticulumBleRnodeRssiMap,
} from './useReticulumBleRnodeRssiMap';

describe('rssiForReticulumBleRnodeRow', () => {
  it('returns RSSI for enabled BLE RNode rows', () => {
    const map = new Map([['aa:bb:cc:dd:ee:ff', -61]]);
    expect(
      rssiForReticulumBleRnodeRow(
        {
          id: '1',
          enabled: true,
          type: 'RNodeInterface',
          serial_port: 'ble://AA:BB:CC:DD:EE:FF',
        },
        map,
      ),
    ).toBe(-61);
  });

  it('returns null when disabled or not ble://', () => {
    const map = new Map([['aa:bb:cc:dd:ee:ff', -61]]);
    expect(
      rssiForReticulumBleRnodeRow(
        {
          id: '1',
          enabled: false,
          type: 'RNodeInterface',
          serial_port: 'ble://AA:BB:CC:DD:EE:FF',
        },
        map,
      ),
    ).toBeNull();
    expect(
      rssiForReticulumBleRnodeRow(
        {
          id: '2',
          enabled: true,
          type: 'RNodeInterface',
          serial_port: '/dev/ttyUSB0',
        },
        map,
      ),
    ).toBeNull();
  });

  it('normalizes MAC case when looking up RSSI', () => {
    const map = new Map([['aa:bb:cc:dd:ee:ff', -70]]);
    expect(
      rssiForReticulumBleRnodeRow(
        {
          id: '1',
          enabled: true,
          type: 'rnode',
          serial_port: 'ble://aa:bb:cc:dd:ee:ff',
        },
        map,
      ),
    ).toBe(-70);
  });
});

describe('useReticulumBleRnodeRssiMap', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.electronAPI.bleCoexistence.acquireScan = vi.fn().mockResolvedValue({});
    window.electronAPI.bleCoexistence.releaseScan = vi.fn().mockResolvedValue({});
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: true });
      }
      if (path.startsWith('/api/v1/ble/scan')) {
        return Promise.resolve({
          devices: [{ address: 'AA:BB:CC:DD:EE:FF', rssi: -58, kind: 'rnode' }],
        });
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('polls sidecar scan and maps RSSI for enabled BLE RNode addresses', async () => {
    const { result } = renderHook(() =>
      useReticulumBleRnodeRssiMap(
        [
          {
            id: '1',
            enabled: true,
            type: 'rnode',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ],
        true,
      ),
    );

    await waitFor(() => {
      expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-58);
    });
    expect(window.electronAPI.bleCoexistence.acquireScan).toHaveBeenCalledWith('reticulum');
    expect(window.electronAPI.bleCoexistence.releaseScan).toHaveBeenCalledWith('reticulum');
  });

  it('stays empty when sidecar is not running', () => {
    const { result } = renderHook(() =>
      useReticulumBleRnodeRssiMap(
        [
          {
            id: '1',
            enabled: true,
            type: 'rnode',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ],
        false,
      ),
    );
    expect(result.current.size).toBe(0);
    expect(window.electronAPI.reticulum.proxyGet).not.toHaveBeenCalled();
  });

  it('does not scan when there are no enabled BLE RNode targets', () => {
    const { result } = renderHook(() =>
      useReticulumBleRnodeRssiMap(
        [
          {
            id: '1',
            enabled: false,
            type: 'rnode',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ],
        true,
      ),
    );
    expect(result.current.size).toBe(0);
  });

  it('does not restart BLE scan poll when interfaces array identity churns', async () => {
    const { result } = renderHook(() =>
      useReticulumBleRnodeRssiMap(
        [
          {
            id: '1',
            enabled: true,
            type: 'rnode',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ],
        true,
      ),
    );
    await waitFor(() => {
      expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-58);
    });
    const scanCalls = () =>
      vi
        .mocked(window.electronAPI.reticulum.proxyGet)
        .mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('/api/v1/ble/scan'))
        .length;
    const afterFirst = scanCalls();
    // setState from the first poll re-renders with a new inline interfaces[]; must not loop.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(scanCalls()).toBe(afterFirst);
  });

  it('preserves last RSSI when a later scan omits the address', async () => {
    let scanCount = 0;
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: true });
      }
      if (path.startsWith('/api/v1/ble/scan')) {
        scanCount += 1;
        if (scanCount === 1) {
          return Promise.resolve({
            devices: [{ address: 'AA:BB:CC:DD:EE:FF', rssi: -62, kind: 'rnode' }],
          });
        }
        return Promise.resolve({ devices: [] });
      }
      return Promise.resolve({});
    });

    const { result } = renderHook(() =>
      useReticulumBleRnodeRssiMap(
        [
          {
            id: '1',
            enabled: true,
            type: 'rnode',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ],
        true,
      ),
    );

    await waitFor(() => {
      expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-62);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    await waitFor(() => {
      expect(scanCount).toBeGreaterThanOrEqual(2);
    });
    expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-62);
  });

  it('does not clear RSSI map on brief empty interface hydrate while sidecar is running', async () => {
    const { result, rerender } = renderHook(
      ({ ifaces }: { ifaces: Parameters<typeof useReticulumBleRnodeRssiMap>[0] }) =>
        useReticulumBleRnodeRssiMap(ifaces, true),
      {
        initialProps: {
          ifaces: [
            {
              id: '1',
              enabled: true,
              type: 'rnode',
              serial_port: 'ble://AA:BB:CC:DD:EE:FF',
            },
          ],
        },
      },
    );

    await waitFor(() => {
      expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-58);
    });

    act(() => {
      rerender({ ifaces: [] });
    });
    expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-58);
  });

  it('expires sticky BLE targets after the idle grace window when interfaces stay empty', async () => {
    const { result, rerender } = renderHook(
      ({ ifaces }: { ifaces: Parameters<typeof useReticulumBleRnodeRssiMap>[0] }) =>
        useReticulumBleRnodeRssiMap(ifaces, true),
      {
        initialProps: {
          ifaces: [
            {
              id: '1',
              enabled: true,
              type: 'rnode',
              serial_port: 'ble://AA:BB:CC:DD:EE:FF',
            },
          ],
        },
      },
    );

    await waitFor(() => {
      expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-58);
    });

    // Idle grace starts on empty, not when targets were first seen.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-58);

    act(() => {
      rerender({ ifaces: [] });
    });
    expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-58);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-58);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current.size).toBe(0);
  });

  it('bursts until first sample then steadies', async () => {
    let scanCount = 0;
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/ble/availability') {
        return Promise.resolve({ available: true });
      }
      if (path.startsWith('/api/v1/ble/scan')) {
        scanCount += 1;
        if (scanCount < 3) {
          return Promise.resolve({ devices: [] });
        }
        return Promise.resolve({
          devices: [{ address: 'AA:BB:CC:DD:EE:FF', rssi: -55, kind: 'rnode' }],
        });
      }
      return Promise.resolve({});
    });

    const { result } = renderHook(() =>
      useReticulumBleRnodeRssiMap(
        [
          {
            id: '1',
            enabled: true,
            type: 'rnode',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ],
        true,
      ),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await waitFor(() => {
      expect(result.current.get('aa:bb:cc:dd:ee:ff')).toBe(-55);
    });
    expect(scanCount).toBeGreaterThanOrEqual(3);
  });
});
