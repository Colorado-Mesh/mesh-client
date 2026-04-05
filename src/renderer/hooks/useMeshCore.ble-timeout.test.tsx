import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/withTimeout', () => ({
  withTimeout: vi.fn((promise: Promise<unknown>) => promise),
}));

import { withTimeout } from '../../shared/withTimeout';
import { useMeshCore } from './useMeshCore';

describe('useMeshCore BLE Noble IPC timeout handling', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  let userAgentSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.disconnectNobleBle).mockResolvedValue(undefined);
    vi.mocked(withTimeout).mockImplementation((promise: Promise<unknown>) => promise);
  });

  afterEach(() => {
    userAgentSpy?.mockRestore();
    userAgentSpy = null;
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
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[useMeshCore\] connect: BLE Noble IPC attempt failed \{"attempt":1,"maxAttempts":2,"isTimeout":true,"isRetryable":true,"stage":"ipc-open","elapsedMs":\d+,"message":"MeshCore BLE IPC open timed out after 25000ms"\}/,
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect: BLE Noble IPC timed out; advise retry, BLE power-cycle, or Serial/TCP fallback {"stage":"ipc-open"}',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect error {"userMessage":"Bluetooth connection timed out while opening MeshCore over Noble IPC. Retry, power-cycle BLE on the device, or use Serial/TCP.","raw":"MeshCore BLE IPC open timed out after 25000ms","bleTimeoutStage":"ipc-open"}',
    );
  });

  it('disconnects and surfaces timeout guidance when protocol handshake stalls', async () => {
    let handshakeAttempt = 0;
    vi.mocked(withTimeout).mockImplementation(
      async (promise: Promise<unknown>, ms: number, label: string) => {
        if (label === 'MeshCore BLE protocol handshake') {
          handshakeAttempt += 1;
          throw new Error(`MeshCore BLE protocol handshake timed out after ${ms}ms`);
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
      '[useMeshCore] connect: BLE Noble IPC timed out; advise retry, BLE power-cycle, or Serial/TCP fallback {"stage":"protocol-handshake"}',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[useMeshCore\] connect error .*MeshCore BLE protocol handshake timed out after \d+ms.*"bleTimeoutStage":"protocol-handshake"/,
      ),
    );
  });

  it('retries once after IPC-open timeout before second-attempt handshake timeout', async () => {
    vi.mocked(window.electronAPI.connectNobleBle)
      .mockRejectedValueOnce(new Error('MeshCore BLE IPC open timed out after 25000ms'))
      .mockResolvedValueOnce({ ok: true });

    vi.mocked(withTimeout).mockImplementation(
      async (promise: Promise<unknown>, ms: number, label: string) => {
        if (label === 'MeshCore BLE protocol handshake') {
          throw new Error(`MeshCore BLE protocol handshake timed out after ${ms}ms`);
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
      expect.stringMatching(
        /\[useMeshCore\] connect: BLE Noble IPC attempt failed \{"attempt":1,"maxAttempts":2,"isTimeout":true,"isRetryable":true,"stage":"ipc-open"/,
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[useMeshCore\] connect: BLE Noble IPC attempt failed \{"attempt":2,"maxAttempts":2,"isTimeout":true,"isRetryable":true,"stage":"protocol-handshake"/,
      ),
    );
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
      expect.stringMatching(
        /\[useMeshCore\] connect: BLE Noble IPC attempt failed \{"attempt":1,"maxAttempts":2,"isTimeout":false,"isRetryable":false,"stage":"unknown"/,
      ),
    );
  });

  it('does not misclassify native debugfs permission stderr as BLE timeout stage', async () => {
    vi.mocked(window.electronAPI.connectNobleBle).mockRejectedValue(
      new Error(
        'cannot create /sys/kernel/debug/bluetooth/hci0/conn_min_interval: Permission denied',
      ),
    );

    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connect('ble', undefined, 'ble-device-debugfs');
      }),
    ).rejects.toThrow(
      'cannot create /sys/kernel/debug/bluetooth/hci0/conn_min_interval: Permission denied',
    );

    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[useMeshCore\] connect: BLE Noble IPC attempt failed \{"attempt":1,"maxAttempts":2,"isTimeout":false,"isRetryable":false,"stage":"unknown"/,
      ),
    );
  });

  it('logs peripheral disconnect signal during handshake timeout path', async () => {
    let onDisconnected: ((sessionId: 'meshtastic' | 'meshcore') => void) | null = null;
    vi.mocked(window.electronAPI.onNobleBleDisconnected).mockImplementation((cb) => {
      onDisconnected = cb;
      return () => {};
    });
    vi.mocked(withTimeout).mockImplementation(
      async (promise: Promise<unknown>, ms: number, label: string) => {
        if (label === 'MeshCore BLE protocol handshake') {
          onDisconnected?.('meshcore');
          // Handshake Promise.race rejects when disconnect fires; mock throws without awaiting it.
          void promise.catch(() => {});
          throw new Error(`MeshCore BLE protocol handshake timed out after ${ms}ms`);
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

  it('retries and surfaces timeout guidance when main-process BLE connectAsync times out', async () => {
    // Simulates the Linux/Windows case where peripheral.connectAsync() in the main process
    // times out and the error propagates through IPC to the renderer.
    vi.mocked(window.electronAPI.connectNobleBle).mockRejectedValue(
      new Error('BLE connectAsync timed out after 30000ms'),
    );

    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connect('ble', undefined, 'ble-device-linux');
      }),
    ).rejects.toThrow(
      'Bluetooth connection timed out while opening MeshCore over Noble IPC. Retry, power-cycle BLE on the device, or use Serial/TCP.',
    );

    // Should retry once (main-process timeout is now recognized as a retryable timeout).
    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[useMeshCore\] connect: BLE Noble IPC attempt failed \{"attempt":1,"maxAttempts":2,"isTimeout":true,"isRetryable":true,"stage":"ipc-open","elapsedMs":\d+,"message":"BLE connectAsync timed out after 30000ms"\}/,
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect: BLE Noble IPC timed out; advise retry, BLE power-cycle, or Serial/TCP fallback {"stage":"ipc-open"}',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[useMeshCore] connect error {"userMessage":"Bluetooth connection timed out while opening MeshCore over Noble IPC. Retry, power-cycle BLE on the device, or use Serial/TCP.","raw":"BLE connectAsync timed out after 30000ms","bleTimeoutStage":"ipc-open"}',
    );
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
      '[useMeshCore] connect error {"userMessage":"{\\"code\\":\\"BLE_CUSTOM\\",\\"detail\\":\\"adapter glitch\\"}","raw":"{\\"code\\":\\"BLE_CUSTOM\\",\\"detail\\":\\"adapter glitch\\"}","bleTimeoutStage":null}',
    );
  });

  it('retries once on retryable non-timeout "already in progress" errors', async () => {
    vi.mocked(window.electronAPI.connectNobleBle).mockRejectedValue(
      new Error('Connection already in progress'),
    );
    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connect('ble', undefined, 'ble-device-7');
      }),
    ).rejects.toThrow(
      'Bluetooth connection already in progress. Wait for it to finish or try Serial/USB instead.',
    );

    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[useMeshCore\] connect: BLE Noble IPC attempt failed \{"attempt":1,"maxAttempts":2,"isTimeout":false,"isRetryable":true,"stage":"unknown"/,
      ),
    );
  });

  it('retries once after WinRT GATT unreachable during service discovery', async () => {
    vi.mocked(window.electronAPI.connectNobleBle)
      .mockRejectedValueOnce(new Error('Device is unreachable while discovering services'))
      .mockResolvedValueOnce({ ok: true });

    vi.mocked(withTimeout).mockImplementation(
      async (promise: Promise<unknown>, ms: number, label: string) => {
        if (label === 'MeshCore BLE protocol handshake') {
          throw new Error(`MeshCore BLE protocol handshake timed out after ${ms}ms`);
        }
        return promise;
      },
    );

    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connect('ble', undefined, 'ble-device-unreachable');
      }),
    ).rejects.toThrow(
      'Bluetooth connected but MeshCore protocol handshake did not complete before disconnect/timeout. Retry, keep the device awake and nearby, power-cycle BLE, or use Serial/TCP.',
    );

    expect(window.electronAPI.connectNobleBle).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[useMeshCore\] connect: BLE Noble IPC attempt failed \{"attempt":1,"maxAttempts":2,"isTimeout":false,"isRetryable":true,"stage":"unknown","elapsedMs":\d+,"message":"Device is unreachable while discovering services"\}/,
      ),
    );
  });
});

describe('useMeshCore Linux BLE routing', () => {
  let userAgentSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      );
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.connectNobleBle).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    userAgentSpy?.mockRestore();
    userAgentSpy = null;
  });

  it('uses Web Bluetooth path on Linux and does not call Noble IPC connect', async () => {
    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        // Linux path does not require a peripheral ID and should not touch noble IPC.
        await result.current.connect('ble', undefined, undefined);
      }),
    ).rejects.toThrow(/Web Bluetooth is not available|navigator\.bluetooth/i);

    expect(window.electronAPI.connectNobleBle).not.toHaveBeenCalled();
  });
});
