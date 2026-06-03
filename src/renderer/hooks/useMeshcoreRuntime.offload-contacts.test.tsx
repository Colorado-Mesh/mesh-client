/**
 * Regression: offload must persist radio contact pubkeys to SQLite before removeContact.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pubkeyToNodeId } from '../lib/meshcoreUtils';

vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const MOCK_USB_VENDOR_ID = 0x1234;
const MOCK_USB_PRODUCT_ID = 0x5678;
const PEER_PUBKEY_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
const SELF_PUBKEY = new Uint8Array(32).fill(0xcd);

function pubKeyBytesFromHex(hex: string): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return b;
}

const PEER_PUBKEY = pubKeyBytesFromHex(PEER_PUBKEY_HEX);
const PEER_NODE_ID = pubkeyToNodeId(PEER_PUBKEY);
const MY_NODE_ID = pubkeyToNodeId(SELF_PUBKEY);

const offloadCallOrder: string[] = [];
const getContactsMock = vi.fn();
const getSelfInfoMock = vi.fn();
const removeContactMock = vi.fn();

vi.mock('@liamcottle/meshcore.js', () => {
  class MockWebSerialConnection {
    constructor(port: unknown) {
      void port;
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
    removeContact = removeContactMock;
    getChannels = vi.fn().mockResolvedValue([]);
    deviceQuery = vi.fn().mockResolvedValue({
      firmwareVer: 1,
      firmware_build_date: 'test',
      manufacturerModel: 'test',
    });
    syncDeviceTime = vi.fn().mockResolvedValue(undefined);
    getBatteryVoltage = vi.fn().mockResolvedValue({ batteryMilliVolts: 4200 });
    sendToRadioFrame = vi.fn().mockRejectedValue(new Error('mocked'));
  }

  class MockSerialConnection {
    async write(bytes: Uint8Array) {
      await Promise.resolve();
      void bytes;
    }
    async onDataReceived(value: Uint8Array) {
      await Promise.resolve();
      void value;
    }
    async onConnected() {
      await Promise.resolve();
    }
    onDisconnected() {
      return undefined;
    }
    async close() {
      await Promise.resolve();
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
    sendToRadioFrame = vi.fn().mockRejectedValue(new Error('mocked'));
  }

  class MockConnection {
    async write(bytes: Uint8Array) {
      await Promise.resolve();
      void bytes;
    }
    async sendToRadioFrame(data: Uint8Array) {
      await Promise.resolve();
      void data;
    }
    async onConnected() {
      await Promise.resolve();
    }
    onDisconnected() {
      return undefined;
    }
    onFrameReceived() {
      return undefined;
    }
    async close() {
      await Promise.resolve();
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
  }

  return {
    CayenneLpp: { parse: vi.fn().mockReturnValue([]) },
    Connection: MockConnection,
    SerialConnection: MockSerialConnection,
    WebSerialConnection: MockWebSerialConnection,
  };
});

import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';

function makeMockSerialPort() {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi
      .fn()
      .mockReturnValue({ usbVendorId: MOCK_USB_VENDOR_ID, usbProductId: MOCK_USB_PRODUCT_ID }),
  };
}

describe('useMeshcoreRuntime offloadContactsFromRadio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offloadCallOrder.length = 0;
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    getContactsMock.mockResolvedValue([
      {
        publicKey: PEER_PUBKEY,
        type: 1,
        advName: 'PeerOffload',
        lastAdvert: 1_700_000_000,
        advLat: 0,
        advLon: 0,
        flags: 0,
        outPathLen: 0,
        outPath: new Uint8Array(0),
      },
      {
        publicKey: SELF_PUBKEY,
        type: 1,
        advName: 'SelfRadio',
        lastAdvert: 1_700_000_000,
        advLat: 0,
        advLon: 0,
        flags: 0,
        outPathLen: 0,
        outPath: new Uint8Array(0),
      },
    ]);
    removeContactMock.mockImplementation(() => {
      offloadCallOrder.push('remove');
      return Promise.resolve();
    });
    vi.mocked(window.electronAPI.db.saveMeshcoreContactsBatch).mockImplementation(() => {
      offloadCallOrder.push('batch');
      return Promise.resolve(0);
    });
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.markAllMeshcoreContactsOffRadio).mockResolvedValue({
      changes: 0,
    });
  });

  it('awaits saveMeshcoreContactsBatch before removeContact', async () => {
    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: vi.fn().mockResolvedValue(port) },
    });

    const { result } = renderHook(() => useMeshcoreRuntime());

    await act(async () => {
      await result.current.connect('serial');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    offloadCallOrder.length = 0;
    vi.mocked(window.electronAPI.db.saveMeshcoreContactsBatch).mockClear();
    removeContactMock.mockClear();
    vi.mocked(window.electronAPI.db.saveMeshcoreContactsBatch).mockImplementation(() => {
      offloadCallOrder.push('batch');
      return Promise.resolve(0);
    });
    removeContactMock.mockImplementation(() => {
      offloadCallOrder.push('remove');
      return Promise.resolve();
    });

    await act(async () => {
      const removed = await result.current.offloadContactsFromRadio();
      expect(removed).toBe(1);
    });

    expect(offloadCallOrder).toEqual(['batch', 'remove']);
    expect(vi.mocked(window.electronAPI.db.saveMeshcoreContactsBatch)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          node_id: PEER_NODE_ID,
          public_key: PEER_PUBKEY_HEX,
          on_radio: 1,
        }),
      ]),
    );
    expect(removeContactMock).toHaveBeenCalledWith(PEER_PUBKEY);
    expect(removeContactMock).not.toHaveBeenCalledWith(SELF_PUBKEY);
    void MY_NODE_ID;
  });
});
