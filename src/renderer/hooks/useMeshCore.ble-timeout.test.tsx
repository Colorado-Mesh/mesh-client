import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/withTimeout', () => ({
  withTimeout: vi.fn((promise: Promise<unknown>) => promise),
}));

import { withTimeout } from '../../shared/withTimeout';
import { useMeshCore } from './useMeshCore';

describe('useMeshCore BLE Noble IPC timeout handling', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.disconnectNobleBle).mockResolvedValue(undefined);
    vi.mocked(withTimeout).mockImplementation((promise: Promise<unknown>) => promise);
  });

  it('fails fast with user-facing timeout guidance when IPC open times out', async () => {
    vi.mocked(window.electronAPI.connectNobleBle).mockRejectedValue(
      new Error('MeshCore BLE IPC open timed out after 25000ms'),
    );

    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connect('ble', undefined, 'ble-device-1');
      }),
    ).rejects.toThrow(
      'Bluetooth connection timed out while opening MeshCore over Noble IPC. Retry, power-cycle BLE on the device, or use Serial/TCP.',
    );

    expect(window.electronAPI.disconnectNobleBle).toHaveBeenCalledWith('meshcore');
    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith('[useMeshCore] connect: BLE Noble IPC attempt failed', {
      attempt: 1,
      maxAttempts: 2,
      isTimeout: true,
      stage: 'ipc-open',
      elapsedMs: expect.any(Number),
      message: 'MeshCore BLE IPC open timed out after 25000ms',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect: BLE Noble IPC timed out; advise retry, BLE power-cycle, or Serial/TCP fallback',
      { stage: 'ipc-open' },
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect error',
      'Bluetooth connection timed out while opening MeshCore over Noble IPC. Retry, power-cycle BLE on the device, or use Serial/TCP.',
      'MeshCore BLE IPC open timed out after 25000ms',
      { bleTimeoutStage: 'ipc-open' },
    );
  });

  it('disconnects and surfaces timeout guidance when protocol handshake stalls', async () => {
    let handshakeAttempt = 0;
    vi.mocked(withTimeout).mockImplementation(
      async (promise: Promise<unknown>, _ms: number, label: string) => {
        if (label === 'MeshCore BLE protocol handshake') {
          handshakeAttempt += 1;
          throw new Error('MeshCore BLE protocol handshake timed out after 20000ms');
        }
        return promise;
      },
    );

    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connect('ble', undefined, 'ble-device-2');
      }),
    ).rejects.toThrow(
      'Bluetooth connected but MeshCore protocol handshake did not complete before disconnect/timeout. Retry, keep the device awake and nearby, power-cycle BLE, or use Serial/TCP.',
    );

    expect(handshakeAttempt).toBe(2);
    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledWith('meshcore', 'ble-device-2');
    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.disconnectNobleBle).toHaveBeenCalledWith('meshcore');
    expect(warnSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect: BLE Noble IPC timed out; advise retry, BLE power-cycle, or Serial/TCP fallback',
      { stage: 'protocol-handshake' },
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect error',
      'Bluetooth connected but MeshCore protocol handshake did not complete before disconnect/timeout. Retry, keep the device awake and nearby, power-cycle BLE, or use Serial/TCP.',
      'MeshCore BLE protocol handshake timed out after 20000ms',
      { bleTimeoutStage: 'protocol-handshake' },
    );
  });

  it('retries once after IPC-open timeout before second-attempt handshake timeout', async () => {
    vi.mocked(window.electronAPI.connectNobleBle)
      .mockRejectedValueOnce(new Error('MeshCore BLE IPC open timed out after 25000ms'))
      .mockResolvedValueOnce(undefined);

    vi.mocked(withTimeout).mockImplementation(
      async (promise: Promise<unknown>, _ms: number, label: string) => {
        if (label === 'MeshCore BLE protocol handshake') {
          throw new Error('MeshCore BLE protocol handshake timed out after 20000ms');
        }
        return promise;
      },
    );

    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connect('ble', undefined, 'ble-device-3');
      }),
    ).rejects.toThrow(
      'Bluetooth connected but MeshCore protocol handshake did not complete before disconnect/timeout. Retry, keep the device awake and nearby, power-cycle BLE, or use Serial/TCP.',
    );

    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect: BLE Noble IPC attempt failed',
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 2,
        isTimeout: true,
        stage: 'ipc-open',
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect: BLE Noble IPC attempt failed',
      expect.objectContaining({
        attempt: 2,
        maxAttempts: 2,
        isTimeout: true,
        stage: 'protocol-handshake',
      }),
    );
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('does not retry non-timeout BLE failures', async () => {
    vi.mocked(window.electronAPI.connectNobleBle).mockRejectedValue(
      new Error('Bluetooth adapter is not available'),
    );

    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connect('ble', undefined, 'ble-device-4');
      }),
    ).rejects.toThrow('Bluetooth adapter is not available');

    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect: BLE Noble IPC attempt failed',
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 2,
        isTimeout: false,
        stage: null,
      }),
    );
  });

  it('logs peripheral disconnect signal during handshake timeout path', async () => {
    let onDisconnected: ((sessionId: 'meshtastic' | 'meshcore') => void) | null = null;
    vi.mocked(window.electronAPI.onNobleBleDisconnected).mockImplementation((cb) => {
      onDisconnected = cb;
      return () => {};
    });
    vi.mocked(withTimeout).mockImplementation(
      async (promise: Promise<unknown>, _ms: number, label: string) => {
        if (label === 'MeshCore BLE protocol handshake') {
          onDisconnected?.('meshcore');
          throw new Error('MeshCore BLE protocol handshake timed out after 20000ms');
        }
        return promise;
      },
    );

    const { result } = renderHook(() => useMeshCore());
    await expect(
      act(async () => {
        await result.current.connect('ble', undefined, 'ble-device-5');
      }),
    ).rejects.toThrow(
      'Bluetooth connected but MeshCore protocol handshake did not complete before disconnect/timeout.',
    );

    expect(warnSpy).toHaveBeenCalledWith('[IpcNobleConnection:meshcore] peripheral disconnected');
  });

  it('stringifies object-shaped non-timeout BLE errors', async () => {
    vi.mocked(window.electronAPI.connectNobleBle).mockRejectedValue({
      code: 'BLE_CUSTOM',
      detail: 'adapter glitch',
    });
    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connect('ble', undefined, 'ble-device-6');
      }),
    ).rejects.toThrow('{"code":"BLE_CUSTOM","detail":"adapter glitch"}');

    expect(errorSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect error',
      '{"code":"BLE_CUSTOM","detail":"adapter glitch"}',
      '{"code":"BLE_CUSTOM","detail":"adapter glitch"}',
      { bleTimeoutStage: null },
    );
  });
});
