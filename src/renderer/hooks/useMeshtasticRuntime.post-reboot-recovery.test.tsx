import type { MeshDevice } from '@meshtastic/core';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { MESHTASTIC_POST_REBOOT_RECONNECT_DELAY_MS } from '../lib/timeConstants';
import { useMeshtasticRuntime } from '../runtime/useMeshtasticRuntime';

function createStubDevice(overrides: Partial<MeshDevice> = {}): MeshDevice {
  const statusSubscribers = new Set<(status: number) => void>();
  const noopSub = { subscribe: () => () => {} };
  const events = new Proxy({} as MeshDevice['events'], {
    get: (_target, prop) => {
      if (prop === 'onDeviceStatus') {
        return {
          subscribe: (cb: (status: number) => void) => {
            statusSubscribers.add(cb);
            return () => statusSubscribers.delete(cb);
          },
        };
      }
      return noopSub;
    },
  });

  const device = {
    configure: vi.fn().mockResolvedValue(undefined),
    commitEditSettings: vi.fn().mockResolvedValue(undefined),
    events,
    transport: {},
    emitDeviceStatus(status: number) {
      for (const cb of statusSubscribers) cb(status);
    },
    ...overrides,
  } as unknown as MeshDevice & { emitDeviceStatus: (status: number) => void };

  return device;
}

describe('useMeshtasticRuntime post-reboot recovery', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let connectSpy: ReturnType<typeof vi.spyOn>;
  let getHandleSpy: ReturnType<typeof vi.spyOn>;
  let disconnectSpy: ReturnType<typeof vi.spyOn>;
  let stubDevice: MeshDevice & { emitDeviceStatus: (status: number) => void };

  beforeEach(() => {
    vi.useFakeTimers();
    stubDevice = createStubDevice() as MeshDevice & { emitDeviceStatus: (status: number) => void };
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    connectSpy = vi.spyOn(connectionDriver, 'connect').mockResolvedValue('identity-test');
    getHandleSpy = vi.spyOn(connectionDriver, 'getHandle').mockReturnValue(stubDevice);
    disconnectSpy = vi.spyOn(connectionDriver, 'disconnect').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleWarnSpy.mockRestore();
    connectSpy.mockRestore();
    getHandleSpy.mockRestore();
    disconnectSpy.mockRestore();
  });

  it('commitConfig alone does not schedule transport reset (waits for DeviceRestarting)', async () => {
    const { result } = renderHook(() => useMeshtasticRuntime());

    await act(async () => {
      await result.current.connectAutomatic('serial', undefined, 'port-abc');
    });

    await act(async () => {
      await result.current.commitConfig();
    });

    expect(stubDevice.commitEditSettings).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('post-commit reboot recovery scheduled'),
    );

    act(() => {
      vi.advanceTimersByTime(MESHTASTIC_POST_REBOOT_RECONNECT_DELAY_MS + 1_000);
    });

    expect(disconnectSpy).not.toHaveBeenCalled();
  });

  it('DeviceRestarting triggers recovery after grace delay', async () => {
    const { result } = renderHook(() => useMeshtasticRuntime());

    await act(async () => {
      await result.current.connect('ble', undefined, 'ble-peripheral-1');
    });

    act(() => {
      stubDevice.emitDeviceStatus(1);
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('post-commit reboot recovery scheduled (DeviceRestarting)'),
    );

    await act(async () => {
      vi.advanceTimersByTime(MESHTASTIC_POST_REBOOT_RECONNECT_DELAY_MS);
      await Promise.resolve();
    });

    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('finalizeDriverDisconnect clears pending reboot recovery timer', async () => {
    const { result } = renderHook(() => useMeshtasticRuntime());

    await act(async () => {
      await result.current.connectAutomatic('serial', undefined, 'port-abc');
    });

    act(() => {
      stubDevice.emitDeviceStatus(1);
    });

    await act(async () => {
      await result.current.disconnect();
    });

    disconnectSpy.mockClear();

    act(() => {
      vi.advanceTimersByTime(MESHTASTIC_POST_REBOOT_RECONNECT_DELAY_MS + 1_000);
    });

    expect(disconnectSpy).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('disconnected');
  });
});
