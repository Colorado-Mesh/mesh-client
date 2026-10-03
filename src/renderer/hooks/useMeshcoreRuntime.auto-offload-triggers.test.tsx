/**
 * Auto-offload triggers wired from the runtime: radio max from deviceQuery, count check on
 * connect / refreshContacts, and ERR_CODE_TABLE_FULL from importContact.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { touch } from '@/shared/touch';

vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const SELF_PUBKEY = new Uint8Array(32).fill(0xcd);
const PEER_PUBKEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

const getContactsMock = vi.fn();
const getSelfInfoMock = vi.fn();
const importContactMock = vi.fn();
const deviceQueryMock = vi.fn();

const capacityMocks = vi.hoisted(() => ({
  maybeRequestMeshcoreAutoOffloadForCount: vi.fn<(count: number) => boolean>(() => false),
  maybeRequestMeshcoreAutoOffloadForError: vi.fn<(err: unknown) => boolean>(() => false),
  setMeshcoreRadioMaxContacts: vi.fn(),
}));

vi.mock('../lib/meshcore/meshcoreContactCapacityPush', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...capacityMocks };
});

vi.mock('@liamcottle/meshcore.js', () => {
  class MockWebSerialConnection {
    constructor(port: unknown) {
      touch(port);
    }
    on() {
      return undefined;
    }
    off() {
      return undefined;
    }
    once() {
      return undefined;
    }
    emit() {
      return undefined;
    }
    close = vi.fn().mockResolvedValue(undefined);
    getSelfInfo = getSelfInfoMock;
    getContacts = getContactsMock;
    importContact = importContactMock;
    removeContact = vi.fn().mockResolvedValue(undefined);
    getChannels = vi.fn().mockResolvedValue([]);
    deviceQuery = deviceQueryMock;
    syncDeviceTime = vi.fn().mockResolvedValue(undefined);
    getBatteryVoltage = vi.fn().mockResolvedValue({ batteryMilliVolts: 4200 });
    sendToRadioFrame = vi.fn().mockRejectedValue(new Error('mocked'));
  }

  class MockSerialConnection {
    on() {
      return undefined;
    }
    off() {
      return undefined;
    }
    once() {
      return undefined;
    }
    emit() {
      return undefined;
    }
  }

  class MockConnection {
    on() {
      return undefined;
    }
    off() {
      return undefined;
    }
    once() {
      return undefined;
    }
    emit() {
      return undefined;
    }
  }

  return {
    CayenneLpp: { parse: vi.fn().mockReturnValue([]) },
    Connection: MockConnection,
    SerialConnection: MockSerialConnection,
    WebSerialConnection: MockWebSerialConnection,
  };
});

import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';
import { resetMeshcoreRuntimeElectronMocks } from '../vitestClearHelpers';

function contactRaw(publicKey: Uint8Array, advName: string) {
  return {
    publicKey,
    type: 1,
    advName,
    lastAdvert: 1_700_000_000,
    advLat: 0,
    advLon: 0,
    flags: 0,
    outPathLen: 0,
    outPath: new Uint8Array(0),
  };
}

async function connectConfigured() {
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      requestPort: vi.fn().mockResolvedValue({
        open: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
      }),
    },
  });
  const hook = renderHook(() => useMeshcoreRuntime());
  await act(async () => {
    await hook.result.current.connect('serial');
  });
  await waitFor(() => {
    expect(hook.result.current.state.status).toBe('configured');
  });
  return hook;
}

describe('useMeshcoreRuntime auto-offload triggers', () => {
  beforeEach(() => {
    resetMeshcoreRuntimeElectronMocks();
    capacityMocks.maybeRequestMeshcoreAutoOffloadForCount.mockClear();
    capacityMocks.maybeRequestMeshcoreAutoOffloadForError.mockClear();
    capacityMocks.setMeshcoreRadioMaxContacts.mockClear();
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    getContactsMock.mockResolvedValue([
      contactRaw(PEER_PUBKEY, 'Peer'),
      contactRaw(SELF_PUBKEY, 'SelfRadio'),
    ]);
    deviceQueryMock.mockResolvedValue({
      firmwareVer: 9,
      firmware_build_date: 'test',
      manufacturerModel: 'test',
      maxContacts: 100,
    });
    importContactMock.mockReset();
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.markAllMeshcoreContactsOffRadio).mockResolvedValue(undefined);
  });

  it('stores the radio-reported max contacts and checks the count after connect', async () => {
    await connectConfigured();

    await waitFor(() => {
      expect(capacityMocks.setMeshcoreRadioMaxContacts).toHaveBeenCalledWith(100);
      expect(capacityMocks.maybeRequestMeshcoreAutoOffloadForCount).toHaveBeenCalled();
    });
    const setOrder = capacityMocks.setMeshcoreRadioMaxContacts.mock.invocationCallOrder[0];
    const countOrder =
      capacityMocks.maybeRequestMeshcoreAutoOffloadForCount.mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(countOrder);
  });

  it('clears the radio max on firmware that does not report it', async () => {
    deviceQueryMock.mockResolvedValue({
      firmwareVer: 2,
      firmware_build_date: 'test',
      manufacturerModel: 'test',
      maxContacts: null,
    });
    await connectConfigured();
    await waitFor(() => {
      expect(capacityMocks.setMeshcoreRadioMaxContacts).toHaveBeenCalledWith(null);
    });
  });

  it('clears the radio max when deviceQuery fails', async () => {
    deviceQueryMock.mockRejectedValue(new Error('deviceQuery timeout'));
    await connectConfigured();
    await waitFor(() => {
      expect(capacityMocks.setMeshcoreRadioMaxContacts).toHaveBeenCalledWith(null);
    });
    expect(capacityMocks.setMeshcoreRadioMaxContacts).not.toHaveBeenCalledWith(100);
  });

  it('checks the on-radio count after refreshContacts', async () => {
    const { result } = await connectConfigured();
    capacityMocks.maybeRequestMeshcoreAutoOffloadForCount.mockClear();

    await act(async () => {
      await result.current.refreshContacts();
    });

    expect(capacityMocks.maybeRequestMeshcoreAutoOffloadForCount).toHaveBeenCalledTimes(1);
    const [count] = capacityMocks.maybeRequestMeshcoreAutoOffloadForCount.mock.calls[0];
    expect(count).toBeGreaterThan(0);
  });

  it('routes an importContact TABLE_FULL rejection to auto-offload', async () => {
    const { result } = await connectConfigured();
    const tableFull = { errCode: 3 };
    importContactMock.mockRejectedValue(tableFull);

    let ok = true;
    await act(async () => {
      ok = await result.current.importContact(new Uint8Array([1, 2, 3]));
    });

    expect(ok).toBe(false);
    expect(capacityMocks.maybeRequestMeshcoreAutoOffloadForError).toHaveBeenCalledWith(tableFull);
  });
});
