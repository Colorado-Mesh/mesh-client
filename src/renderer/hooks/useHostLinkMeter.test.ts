import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NobleBleLinkRssiPayload } from '@/shared/electron-api.types';

import { useHostLinkMeter } from './useHostLinkMeter';

describe('useHostLinkMeter', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    vi.mocked(window.electronAPI.onNobleBleLinkRssi).mockReturnValue(() => {});
    vi.mocked(window.electronAPI.hostLink.probeHttpRtt).mockResolvedValue(40);
    vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockResolvedValue(80);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns unavailable for Linux BLE', () => {
    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshtastic',
        connectionType: 'ble',
        status: 'configured',
        hostAddress: null,
        platform: 'linux',
      }),
    );
    expect(result.current.kind).toBe('unavailable');
  });

  it('returns ble-rssi on darwin and applies Noble IPC updates', async () => {
    let rssiCb: ((p: NobleBleLinkRssiPayload) => void) | null = null;
    vi.mocked(window.electronAPI.onNobleBleLinkRssi).mockImplementation((cb) => {
      rssiCb = cb;
      return () => {};
    });

    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshtastic',
        connectionType: 'ble',
        status: 'configured',
        hostAddress: null,
        platform: 'darwin',
      }),
    );
    expect(result.current.kind).toBe('ble-rssi');
    act(() => {
      rssiCb?.({ sessionId: 'meshtastic', rssi: -72 });
    });
    await waitFor(() => {
      expect(result.current.rssi).toBe(-72);
    });
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'returns ip-rtt for Meshtastic HTTP on %s',
    async (platform) => {
      const { result } = renderHook(() =>
        useHostLinkMeter({
          protocol: 'meshtastic',
          connectionType: 'http',
          status: 'configured',
          hostAddress: 'meshtastic.local',
          platform,
        }),
      );
      expect(result.current.kind).toBe('ip-rtt');
      await waitFor(() => {
        expect(result.current.rttMs).toBe(40);
        expect(result.current.level).toBe(4);
      });
      expect(window.electronAPI.hostLink.probeHttpRtt).toHaveBeenCalled();
    },
  );

  it('returns ip-rtt for Meshtastic TCP via probeTcpRtt', async () => {
    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshtastic',
        connectionType: 'tcp',
        status: 'configured',
        hostAddress: '10.0.0.5:4403',
        platform: 'darwin',
      }),
    );
    expect(result.current.kind).toBe('ip-rtt');
    await waitFor(() => {
      expect(result.current.rttMs).toBe(80);
      expect(result.current.level).toBe(3);
    });
    expect(window.electronAPI.hostLink.probeTcpRtt).toHaveBeenCalledWith('10.0.0.5', 4403);
  });

  it('returns ip-rtt for MeshCore TCP/IP (http transport) via probeTcpRtt', async () => {
    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshcore',
        connectionType: 'http',
        status: 'configured',
        hostAddress: '192.168.1.20:5000',
        platform: 'linux',
      }),
    );
    expect(result.current.kind).toBe('ip-rtt');
    await waitFor(() => {
      expect(result.current.rttMs).toBe(80);
    });
    expect(window.electronAPI.hostLink.probeTcpRtt).toHaveBeenCalledWith('192.168.1.20', 5000);
  });

  it.each(['darwin', 'win32'] as const)('returns ble-rssi on %s', (platform) => {
    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshcore',
        connectionType: 'ble',
        status: 'connected',
        hostAddress: null,
        platform,
      }),
    );
    expect(result.current.kind).toBe('ble-rssi');
  });

  it('ignores Noble RSSI events for a different session', () => {
    let rssiCb: ((p: NobleBleLinkRssiPayload) => void) | null = null;
    vi.mocked(window.electronAPI.onNobleBleLinkRssi).mockImplementation((cb) => {
      rssiCb = cb;
      return () => {};
    });
    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshtastic',
        connectionType: 'ble',
        status: 'configured',
        hostAddress: null,
        platform: 'darwin',
      }),
    );
    act(() => {
      rssiCb?.({ sessionId: 'meshcore', rssi: -50 });
    });
    expect(result.current.rssi).toBeNull();
  });

  it('hides meter when disconnected', () => {
    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshtastic',
        connectionType: 'ble',
        status: 'disconnected',
        hostAddress: null,
        platform: 'darwin',
      }),
    );
    expect(result.current.kind).toBeNull();
  });

  it('hides meter for serial', () => {
    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshcore',
        connectionType: 'serial',
        status: 'configured',
        hostAddress: null,
        platform: 'darwin',
      }),
    );
    expect(result.current.kind).toBeNull();
  });

  it('hides meter for reticulum protocol', () => {
    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'reticulum',
        connectionType: 'ble',
        status: 'configured',
        hostAddress: null,
        platform: 'darwin',
      }),
    );
    expect(result.current.kind).toBeNull();
  });

  it('hides meter while connecting', () => {
    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshtastic',
        connectionType: 'http',
        status: 'connecting',
        hostAddress: 'meshtastic.local',
        platform: 'darwin',
      }),
    );
    expect(result.current.kind).toBeNull();
    expect(window.electronAPI.hostLink.probeHttpRtt).not.toHaveBeenCalled();
  });

  it('keeps ip-rtt kind with null RTT when HTTP probe fails', async () => {
    vi.mocked(window.electronAPI.hostLink.probeHttpRtt).mockResolvedValue(null);
    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshtastic',
        connectionType: 'http',
        status: 'configured',
        hostAddress: 'meshtastic.local',
        platform: 'linux',
      }),
    );
    expect(result.current.kind).toBe('ip-rtt');
    await waitFor(() => {
      expect(window.electronAPI.hostLink.probeHttpRtt).toHaveBeenCalled();
    });
    expect(result.current.rttMs).toBeNull();
    expect(result.current.level).toBeNull();
  });

  it('ignores stale HTTP probe results when a newer probe finishes first', async () => {
    vi.useFakeTimers();
    let resolveSlow: ((value: number | null) => void) | null = null;
    let resolveFast: ((value: number | null) => void) | null = null;
    vi.mocked(window.electronAPI.hostLink.probeHttpRtt)
      .mockImplementationOnce(
        () =>
          new Promise<number | null>((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<number | null>((resolve) => {
            resolveFast = resolve;
          }),
      );

    const { result } = renderHook(() =>
      useHostLinkMeter({
        protocol: 'meshtastic',
        connectionType: 'http',
        status: 'configured',
        hostAddress: 'meshtastic.local',
        platform: 'darwin',
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveSlow).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(resolveFast).not.toBeNull();

    await act(async () => {
      resolveFast?.(25);
      await Promise.resolve();
    });
    expect(result.current.rttMs).toBe(25);

    await act(async () => {
      resolveSlow?.(900);
      await Promise.resolve();
    });
    expect(result.current.rttMs).toBe(25);
  });
});
