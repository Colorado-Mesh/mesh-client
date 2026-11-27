import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { touch } from '@/shared/touch';

/** Every WebSerialConnection the runtime creates, in order (one per serial open). */
const serialConns: MockWebSerialConnectionShape[] = [];

interface MockWebSerialConnectionShape {
  sendFloodAdvert: ReturnType<typeof vi.fn>;
  sendZeroHopAdvert: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  listenerCount(): number;
}

vi.mock('@liamcottle/meshcore.js', () => {
  class MockEvents {
    private listeners = new Map<string | number, Set<(...args: unknown[]) => void>>();
    on(event: string | number, cb: (...args: unknown[]) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)?.add(cb);
    }
    off(event: string | number, cb: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(cb);
    }
    once(event: string | number, cb: (...args: unknown[]) => void) {
      touch(event);
      touch(cb);
    }
    emit(event: string | number, ...args: unknown[]) {
      touch(event);
      touch(args);
    }
    listenerCount(): number {
      let total = 0;
      for (const set of this.listeners.values()) total += set.size;
      return total;
    }
  }

  class MockWebSerialConnection extends MockEvents {
    constructor(port: unknown) {
      super();
      touch(port);
      serialConns.push(this);
    }
    close = vi.fn().mockResolvedValue(undefined);
    getSelfInfo = vi.fn().mockResolvedValue({
      publicKey: new Uint8Array(32).fill(5),
      name: 'Reconnect test radio',
      type: 1,
      txPower: 20,
      maxTxPower: 22,
      advLat: 0,
      advLon: 0,
      radioFreq: 910525,
      radioBw: 62500,
      radioSf: 7,
      radioCr: 5,
    });
    getContacts = vi.fn().mockResolvedValue([]);
    getChannels = vi.fn().mockResolvedValue([]);
    syncDeviceTime = vi.fn().mockResolvedValue(undefined);
    getBatteryVoltage = vi.fn().mockResolvedValue({ batteryMilliVolts: 4200 });
    sendFloodAdvert = vi.fn().mockResolvedValue(undefined);
    sendZeroHopAdvert = vi.fn().mockResolvedValue(undefined);
    sendToRadioFrame = vi.fn().mockRejectedValue(new Error('mocked'));
  }

  class MockConnection extends MockEvents {
    async sendToRadioFrame(data: Uint8Array) {
      await Promise.resolve();
      touch(data);
    }
    async close() {
      await Promise.resolve();
    }
  }

  return {
    CayenneLpp: { parse: vi.fn().mockReturnValue([]) },
    Connection: MockConnection,
    SerialConnection: MockConnection,
    WebSerialConnection: MockWebSerialConnection,
  };
});

import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';
import { resetMeshcoreRuntimeElectronMocks } from '../vitestClearHelpers';

function installSerialPort(): void {
  const port = {
    portId: 'reconnect-port',
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      requestPort: vi.fn().mockResolvedValue(port),
      getPorts: vi.fn().mockResolvedValue([port]),
    },
  });
}

describe('useMeshcoreRuntime serial reconnect then advert', () => {
  let warnSpy: MockInstance<typeof console.warn>;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    resetMeshcoreRuntimeElectronMocks();
    serialConns.length = 0;
    installSerialPort();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Fake clock that still moves with real time, so connect setup timers run normally.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('sends the advert on the reconnected serial session, not the retired one', async () => {
    const rendered = renderHook(() => useMeshcoreRuntime());
    unmount = rendered.unmount;
    const { result } = rendered;

    await act(async () => {
      await result.current.connect('serial');
    });
    expect(result.current.state.status).toBe('configured');
    expect(serialConns).toHaveLength(1);
    // The first session subscribes to radio events, so "none left" below is a real check.
    const listenersWhileLive = serialConns[0].listenerCount();
    expect(listenersWhileLive).toBeGreaterThan(0);

    // Radio goes silent past the dead threshold: the watchdog hands off to reconnect.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(195_000);
    });
    expect(
      warnSpy.mock.calls.some((call: unknown[]) => /^mcL1202 .*serial dead/.test(String(call[0]))),
    ).toBe(true);

    // Let the reconnect controller's backoff run until a second session is configured.
    for (
      let i = 0;
      i < 24 && !(serialConns.length >= 2 && result.current.state.status === 'configured');
      i++
    ) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
    }
    const statusAfter = result.current.state.status;
    const opens = serialConns.length;
    expect({ statusAfter, opens }).toEqual({ statusAfter: 'configured', opens: 2 });

    const [retired, live] = serialConns;
    expect(retired.close).toHaveBeenCalled();

    await act(async () => {
      await result.current.sendAdvert();
    });
    expect(live.sendFloodAdvert).toHaveBeenCalledTimes(1);
    expect(retired.sendFloodAdvert).not.toHaveBeenCalled();
    // No event listener left on the retired connection after reconnect; the live one has them.
    expect(retired.listenerCount()).toBe(0);
    expect(live.listenerCount()).toBe(listenersWhileLive);
  });
});
