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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.disconnectNobleBle).mockResolvedValue(undefined);
    vi.mocked(withTimeout).mockImplementation((promise: Promise<unknown>) => promise);
  });

  it('fails fast with user-facing timeout guidance when IPC open times out', async () => {
    vi.mocked(window.electronAPI.connectNobleBle).mockRejectedValueOnce(
      new Error('MeshCore BLE IPC open timed out after 20000ms'),
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
    expect(warnSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect: BLE Noble IPC timed out; advise retry, BLE power-cycle, or Serial/TCP fallback',
      { stage: 'ipc-open' },
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect error',
      'Bluetooth connection timed out while opening MeshCore over Noble IPC. Retry, power-cycle BLE on the device, or use Serial/TCP.',
      'MeshCore BLE IPC open timed out after 20000ms',
      { bleTimeoutStage: 'ipc-open' },
    );
  });

  it('disconnects and surfaces timeout guidance when protocol handshake stalls', async () => {
    vi.mocked(withTimeout).mockImplementation(
      async (promise: Promise<unknown>, _ms: number, label: string) => {
        if (label === 'MeshCore BLE protocol handshake') {
          throw new Error('MeshCore BLE protocol handshake timed out after 15000ms');
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
      'Bluetooth connection timed out while opening MeshCore over Noble IPC. Retry, power-cycle BLE on the device, or use Serial/TCP.',
    );

    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledWith('meshcore', 'ble-device-2');
    expect(window.electronAPI.disconnectNobleBle).toHaveBeenCalledWith('meshcore');
    expect(warnSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect: BLE Noble IPC timed out; advise retry, BLE power-cycle, or Serial/TCP fallback',
      { stage: 'protocol-handshake' },
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect error',
      'Bluetooth connection timed out while opening MeshCore over Noble IPC. Retry, power-cycle BLE on the device, or use Serial/TCP.',
      'MeshCore BLE protocol handshake timed out after 15000ms',
      { bleTimeoutStage: 'protocol-handshake' },
    );
  });
});
