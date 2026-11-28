import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { touch } from '@/shared/touch';

/** Every WebSerialConnection the runtime creates, keyed by the port id it was opened on. */
const serialConnsByPort = new Map<string, MockWebSerialConnectionShape>();

interface MockWebSerialConnectionShape {
  sendFloodAdvert: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

vi.mock('@liamcottle/meshcore.js', () => {
  class MockEvents {
    on(event: string | number, cb: (...args: unknown[]) => void) {
      touch(event);
      touch(cb);
    }
    off(event: string | number, cb: (...args: unknown[]) => void) {
      touch(event);
      touch(cb);
    }
    once(event: string | number, cb: (...args: unknown[]) => void) {
      touch(event);
      touch(cb);
    }
    emit(event: string | number, ...args: unknown[]) {
      touch(event);
      touch(args);
    }
  }

  class MockWebSerialConnection extends MockEvents {
    private readonly keyByte: number;
    constructor(port: { portId: string; keyByte: number }) {
      super();
      this.keyByte = port.keyByte;
      serialConnsByPort.set(port.portId, this);
    }
    close = vi.fn().mockResolvedValue(undefined);
    // Each port is a different radio, so each open resolves its own identity.
    getSelfInfo = vi.fn(() =>
      Promise.resolve({
        publicKey: new Uint8Array(32).fill(this.keyByte),
        name: `Radio ${this.keyByte}`,
        type: 1,
        txPower: 20,
        maxTxPower: 22,
        advLat: 0,
        advLon: 0,
        radioFreq: 910525,
        radioBw: 62500,
        radioSf: 7,
        radioCr: 5,
      }),
    );
    getContacts = vi.fn().mockResolvedValue([]);
    getChannels = vi.fn().mockResolvedValue([]);
    syncDeviceTime = vi.fn().mockResolvedValue(undefined);
    getBatteryVoltage = vi.fn().mockResolvedValue({ batteryMilliVolts: 4200 });
    sendFloodAdvert = vi.fn().mockResolvedValue(undefined);
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

import { isMeshcoreSetupAbortError } from '../lib/bleConnectErrors';
import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';
import { resetMeshcoreRuntimeElectronMocks } from '../vitestClearHelpers';

function makePort(portId: string, keyByte: number, open: () => Promise<void>) {
  return {
    portId,
    keyByte,
    open: vi.fn(open),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: keyByte }),
  };
}

describe('useMeshcoreRuntime serial auto-connect superseded by a newer connect', () => {
  let warnSpy: MockInstance<typeof console.warn>;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    resetMeshcoreRuntimeElectronMocks();
    serialConnsByPort.clear();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    warnSpy.mockRestore();
  });

  it('leaves the newer session intact when the stale auto-connect open finishes', async () => {
    let releaseAutoOpen: () => void = () => undefined;
    const autoPort = makePort(
      'auto-port',
      3,
      () =>
        new Promise<void>((resolve) => {
          releaseAutoOpen = resolve;
        }),
    );
    const manualPort = makePort('manual-port', 4, () => Promise.resolve());
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        getPorts: vi.fn().mockResolvedValue([autoPort]),
        requestPort: vi.fn().mockResolvedValue(manualPort),
      },
    });

    const rendered = renderHook(() => useMeshcoreRuntime());
    unmount = rendered.unmount;
    const { result } = rendered;

    // 1. Auto-connect starts; its serial open is held.
    let autoError: unknown = null;
    let autoSettled = false;
    const autoConnect = result.current
      .connectAutomatic('serial', undefined, 'auto-port')
      .catch((err: unknown) => {
        autoError = err;
      })
      .finally(() => {
        autoSettled = true;
      });

    await vi.waitFor(() => {
      expect(autoPort.open).toHaveBeenCalled();
    });

    // 2. A newer manual connect supersedes it (prepareRfConnect bumps the setup generation
    //    before its first await); then the held open completes.
    await act(async () => {
      const manualConnect = result.current.connect('serial');
      releaseAutoOpen();
      await manualConnect;
      await autoConnect;
    });

    expect(autoSettled).toBe(true);
    expect(isMeshcoreSetupAbortError(autoError)).toBe(true);
    expect(serialConnsByPort.get('auto-port')?.close).toHaveBeenCalled();

    // 3. The newer session is untouched by the stale attempt's failure handling.
    expect(result.current.state.status).toBe('configured');
    await act(async () => {
      await result.current.sendAdvert();
    });
    expect(serialConnsByPort.get('manual-port')?.sendFloodAdvert).toHaveBeenCalledTimes(1);
    expect(serialConnsByPort.get('auto-port')?.sendFloodAdvert).not.toHaveBeenCalled();
  });
});
