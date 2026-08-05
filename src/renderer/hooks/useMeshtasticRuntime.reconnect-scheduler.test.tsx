import type { MeshDevice } from '@meshtastic/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import * as systemPowerState from '../lib/systemPowerState';
import { useMeshtasticRuntime } from '../runtime/useMeshtasticRuntime';

function createStubDevice(overrides: Partial<MeshDevice> = {}): MeshDevice & {
  emitDeviceStatus: (status: number) => void;
} {
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
  return {
    configure: vi.fn().mockResolvedValue(undefined),
    events,
    transport: {},
    emitDeviceStatus(status: number) {
      for (const cb of statusSubscribers) cb(status);
    },
    ...overrides,
  } as unknown as MeshDevice & { emitDeviceStatus: (status: number) => void };
}

describe('useMeshtasticRuntime reconnect scheduler (hook-level)', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
  let connectSpy: ReturnType<typeof vi.spyOn>;
  let getHandleSpy: ReturnType<typeof vi.spyOn>;
  let disconnectSpy: ReturnType<typeof vi.spyOn>;
  let delaySpy: ReturnType<typeof vi.spyOn>;
  let stubDevice: MeshDevice & { emitDeviceStatus: (status: number) => void };
  let nobleDisconnectedHandlers: ((sessionId: string) => void)[];
  let delayGates: {
    shouldAbort: () => boolean;
    resolve: (result: 'done' | 'aborted' | 'suspended') => void;
  }[];

  beforeEach(() => {
    stubDevice = createStubDevice();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    connectSpy = vi.spyOn(connectionDriver, 'connect').mockResolvedValue('identity-test');
    getHandleSpy = vi.spyOn(connectionDriver, 'getHandle').mockReturnValue(stubDevice);
    disconnectSpy = vi.spyOn(connectionDriver, 'disconnect').mockResolvedValue(undefined);

    nobleDisconnectedHandlers = [];
    vi.mocked(window.electronAPI.onNobleBleDisconnected).mockImplementation((cb) => {
      nobleDisconnectedHandlers.push(cb as (sessionId: string) => void);
      return () => {};
    });
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');

    delayGates = [];
    delaySpy = vi.spyOn(systemPowerState, 'delayUnlessSuspended').mockImplementation(
      (_ms, shouldAbort) =>
        new Promise<'done' | 'aborted' | 'suspended'>((resolve) => {
          delayGates.push({ shouldAbort, resolve });
        }),
    );
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    connectSpy.mockRestore();
    getHandleSpy.mockRestore();
    disconnectSpy.mockRestore();
    delaySpy.mockRestore();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    vi.mocked(window.electronAPI.onNobleBleDisconnected).mockReturnValue(() => {});
  });

  async function settleDelay(result: 'done' | 'aborted' | 'suspended' = 'done') {
    expect(delayGates.length).toBeGreaterThan(0);
    const gate = delayGates[delayGates.length - 1];
    await act(async () => {
      gate.resolve(gate.shouldAbort() ? 'aborted' : result);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('runs one reconnect open per backoff cycle and flushes deferred mid-backoff loss', async () => {
    const { result } = renderHook(() => useMeshtasticRuntime());

    await act(async () => {
      await result.current.connect('http', 'http://127.0.0.1');
    });
    act(() => {
      stubDevice.emitDeviceStatus(7); // DeviceConfigured
    });
    expect(connectSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    // Start reconnect → enters mocked backoff (attemptReconnect / delayUnlessSuspended).
    await act(async () => {
      result.current.onPowerResume();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('reconnecting');
    });
    expect(delaySpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledTimes(1);

    // Mid-backoff connection-lost (Noble disconnect path → handleConnectionLost) must not open
    // a parallel transport — deferred until delay settles / scheduleMeshtasticReconnectAttempt.
    await act(async () => {
      for (const handler of nobleDisconnectedHandlers) {
        handler('meshtastic');
      }
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(consoleDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Connection lost during reconnect backoff — defer until delay settles',
      ),
    );

    // Abort current delay (generation bump) → deferred flush schedules the next attempt.
    await settleDelay('done');
    await waitFor(() => {
      expect(delaySpy).toHaveBeenCalledTimes(2);
    });

    // Complete the deferred cycle's backoff → single reconnect open.
    await settleDelay('done');
    await waitFor(() => {
      expect(connectSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('explicit disconnect prevents reconnect scheduling', async () => {
    const { result } = renderHook(() => useMeshtasticRuntime());

    await act(async () => {
      await result.current.connect('http', 'http://127.0.0.1');
    });
    connectSpy.mockClear();
    delaySpy.mockClear();
    delayGates = [];

    await act(async () => {
      await result.current.disconnect();
    });

    await act(async () => {
      result.current.onPowerResume();
      for (const handler of nobleDisconnectedHandlers) {
        handler('meshtastic');
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(delaySpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('disconnected');
  });
});
