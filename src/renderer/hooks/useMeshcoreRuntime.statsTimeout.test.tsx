import { act, renderHook } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type MockInstance,
  vi,
} from 'vitest';

import { touch } from '@/shared/touch';

type StatsRpcMock = Mock<() => Promise<unknown>>;

const statsCoreMock: StatsRpcMock = vi.fn<() => Promise<unknown>>();
const statsRadioMock: StatsRpcMock = vi.fn<() => Promise<unknown>>();
const statsPacketsMock: StatsRpcMock = vi.fn<() => Promise<unknown>>();

vi.mock('@liamcottle/meshcore.js', () => {
  class MockEvents {
    on(event: string | number, cb: (...args: unknown[]) => void) {
      touch(event);
      touch(cb);
      return undefined;
    }
    off(event: string | number, cb: (...args: unknown[]) => void) {
      touch(event);
      touch(cb);
      return undefined;
    }
    once(event: string | number, cb: (...args: unknown[]) => void) {
      touch(event);
      touch(cb);
      return undefined;
    }
    emit(event: string | number, ...args: unknown[]) {
      touch(event);
      touch(args);
      return undefined;
    }
  }

  class MockWebSerialConnection extends MockEvents {
    constructor(port: unknown) {
      super();
      touch(port);
    }
    close = vi.fn().mockResolvedValue(undefined);
    getSelfInfo = vi.fn().mockResolvedValue({
      publicKey: new Uint8Array(32).fill(9),
      name: 'Stats timeout radio',
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
    getStatsCore = statsCoreMock;
    getStatsRadio = statsRadioMock;
    getStatsPackets = statsPacketsMock;
    sendToRadioFrame = vi.fn().mockRejectedValue(new Error('mocked'));
  }

  class MockConnection extends MockEvents {
    async sendToRadioFrame(data: Uint8Array) {
      await Promise.resolve();
      touch(data);
      return undefined;
    }
    async close() {
      await Promise.resolve();
      return undefined;
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
    portId: 'stats-port',
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: { getPorts: vi.fn().mockResolvedValue([port]) },
  });
}

type StatsKind = 'core' | 'radio' | 'packets';

const STATS_FAILURE_WARN =
  /^mcL(1190|1191) .*stats .*failed .*MeshCore stats (core|radio|packets) timed out/;

/** Periodic (mcL1190) or initial (mcL1191) stats failure warns that name a stats timeout. */
function statsFailureWarns(warnSpy: MockInstance<typeof console.warn>, kind?: StatsKind): string[] {
  return warnSpy.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((line: string) => STATS_FAILURE_WARN.test(line))
    .filter((line: string) => !kind || line.includes(`MeshCore stats ${kind} timed out`));
}

const statsMocks: Record<StatsKind, StatsRpcMock> = {
  core: statsCoreMock,
  radio: statsRadioMock,
  packets: statsPacketsMock,
};

function answerAllStats(): void {
  statsCoreMock.mockResolvedValue({
    type: 0,
    raw: new Uint8Array(),
    data: { batteryMilliVolts: 4100, uptimeSecs: 60, queueLen: 0 },
  });
  statsRadioMock.mockResolvedValue({
    type: 1,
    raw: new Uint8Array(),
    data: { noiseFloor: -110, lastRssi: -80, lastSnr: 7, txAirSecs: 1, rxAirSecs: 2 },
  });
  statsPacketsMock.mockResolvedValue({
    type: 2,
    raw: new Uint8Array(),
    data: { recv: 3, sent: 1, nSentFlood: 1, nSentDirect: 0, nRecvFlood: 2, nRecvDirect: 1 },
  });
}

describe('useMeshcoreRuntime stats poll timeout', () => {
  let warnSpy: MockInstance<typeof console.warn>;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    resetMeshcoreRuntimeElectronMocks();
    statsCoreMock.mockReset();
    statsRadioMock.mockReset();
    statsPacketsMock.mockReset();
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

  async function connectSerial() {
    const rendered = renderHook(() => useMeshcoreRuntime());
    unmount = rendered.unmount;
    await act(async () => {
      await rendered.result.current.connectAutomatic('serial', undefined, 'stats-port');
    });
    expect(rendered.result.current.state.status).toBe('configured');
    return rendered;
  }

  it.each<StatsKind>(['core', 'radio', 'packets'])(
    'warns when the radio never answers the %s stats request, and polls again next tick',
    async (kind) => {
      answerAllStats();
      // A radio that stopped answering: meshcore.js getStats never settles.
      statsMocks[kind].mockImplementation(() => new Promise(() => {}));

      await connectSerial();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      const firstCalls = statsMocks[kind].mock.calls.length;
      expect(firstCalls).toBeGreaterThanOrEqual(1);
      expect(statsFailureWarns(warnSpy, kind).length).toBeGreaterThanOrEqual(1);

      // The hung request must not latch out every later poll.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(statsMocks[kind].mock.calls.length).toBeGreaterThan(firstCalls);
    },
  );

  it('applies stats from a radio that answers, without a failure warning', async () => {
    answerAllStats();

    await connectSerial();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    expect(statsRadioMock).toHaveBeenCalled();
    expect(statsPacketsMock).toHaveBeenCalled();
    expect(statsFailureWarns(warnSpy)).toEqual([]);
  });
});
