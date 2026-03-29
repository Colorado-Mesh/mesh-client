/**
 * Regression: buildNodesFromContacts clears pubKeyMapRef and refills from getContacts() only.
 * Contacts persisted in SQLite (but omitted from a given device snapshot) must still backfill
 * pub keys so DM send can resolve the destination pubkey.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pubkeyToNodeId } from '../lib/meshcoreUtils';

const sendTextMessageMock = vi.fn().mockResolvedValue({
  expectedAckCrc: 1,
  estTimeout: 30_000,
});
const getContactsMock = vi.fn().mockResolvedValue([]);
const getSelfInfoMock = vi.fn();

vi.mock('@liamcottle/meshcore.js', () => {
  class MockWebSerialConnection {
    constructor(port: unknown) {
      void port;
    }
    on(event: string | number, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    off(event: string | number, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    once(event: string | number, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    emit(event: string | number, ...args: unknown[]) {
      void event;
      void args;
      return undefined;
    }
    close = vi.fn().mockResolvedValue(undefined);
    getSelfInfo = getSelfInfoMock;
    getContacts = getContactsMock;
    getChannels = vi.fn().mockResolvedValue([]);
    deviceQuery = vi.fn().mockResolvedValue({
      firmwareVer: 1,
      firmware_build_date: 'test',
      manufacturerModel: 'test',
    });
    syncDeviceTime = vi.fn().mockResolvedValue(undefined);
    getBatteryVoltage = vi.fn().mockResolvedValue({ batteryMilliVolts: 4200 });
    sendTextMessage = sendTextMessageMock;
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

import { useMeshCore } from './useMeshCore';

/** Pubkey whose XOR-folded node id is non-zero (matches import-contacts tests). */
const PEER_PUBKEY_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';

function pubKeyBytesFromHex(hex: string): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return b;
}

const PEER_NODE_ID = pubkeyToNodeId(pubKeyBytesFromHex(PEER_PUBKEY_HEX));
const SELF_PUBKEY = new Uint8Array(32).fill(0xcd);
const MY_NODE_ID = pubkeyToNodeId(SELF_PUBKEY);

function makeMockSerialPort() {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
}

describe('useMeshCore DB pubkey backfill for DM send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContactsMock.mockResolvedValue([]);
    sendTextMessageMock.mockResolvedValue({ expectedAckCrc: 1, estTimeout: 30_000 });
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([
      {
        node_id: PEER_NODE_ID,
        public_key: PEER_PUBKEY_HEX,
        adv_name: 'PeerFromDb',
        contact_type: 1,
        last_advert: 1_700_000_000,
        adv_lat: null,
        adv_lon: null,
        last_snr: null,
        last_rssi: null,
        favorited: 0,
        nickname: null,
      },
    ]);
  });

  it('allows sendMessage DM when getContacts is empty but SQLite has a full pubkey', async () => {
    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
      },
    });

    const { result } = renderHook(() => useMeshCore());

    await act(async () => {
      await result.current.connect('serial');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    expect(result.current.nodes.has(PEER_NODE_ID)).toBe(true);

    await act(async () => {
      await result.current.sendMessage('hello-dm', 0, PEER_NODE_ID);
    });

    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    const call0 = sendTextMessageMock.mock.calls[0];
    expect(call0).toBeDefined();
    expect(call0?.[1]).toBe('hello-dm');
    expect(call0?.[0]).toEqual(pubKeyBytesFromHex(PEER_PUBKEY_HEX));

    await waitFor(() => {
      expect(window.electronAPI.db.saveMeshcoreMessage).toHaveBeenCalled();
    });
    expect(vi.mocked(window.electronAPI.db.saveMeshcoreMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_idx: -1,
        payload: 'hello-dm',
        to_node: PEER_NODE_ID,
      }),
    );
  });
});

describe('useMeshCore DM reply (wire + persistence)', () => {
  const contactRow = {
    node_id: PEER_NODE_ID,
    public_key: PEER_PUBKEY_HEX,
    adv_name: 'PeerFromDb',
    contact_type: 1,
    last_advert: 1_700_000_000,
    adv_lat: null,
    adv_lon: null,
    last_snr: null,
    last_rssi: null,
    favorited: 0,
    nickname: null,
  };

  const dmParentFromPeer = {
    id: 1,
    sender_id: PEER_NODE_ID,
    sender_name: 'Alice',
    payload: 'parent line',
    channel_idx: -1,
    timestamp: 1_700_000_000_000,
    status: 'acked',
    packet_id: 77_777,
    emoji: null as number | null,
    reply_id: null as number | null,
    to_node: MY_NODE_ID,
    received_via: 'rf' as const,
  };

  function resetMocksAndBaseContacts(messagesFromDb: (typeof dmParentFromPeer)[]) {
    vi.clearAllMocks();
    getContactsMock.mockResolvedValue([]);
    sendTextMessageMock.mockResolvedValue({ expectedAckCrc: 1, estTimeout: 30_000 });
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue(messagesFromDb);
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([contactRow]);
  }

  it('prefixes DM text with @[sender_name] when replyId matches a hydrated DM parent', async () => {
    resetMocksAndBaseContacts([dmParentFromPeer]);
    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
      },
    });

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });

    await act(async () => {
      await result.current.connect('serial');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    await act(async () => {
      await result.current.sendMessage('hi', 0, PEER_NODE_ID, 77_777);
    });

    expect(sendTextMessageMock).toHaveBeenCalledWith(
      pubKeyBytesFromHex(PEER_PUBKEY_HEX),
      '@[Alice] hi',
    );

    await waitFor(() => {
      expect(
        vi.mocked(window.electronAPI.db.saveMeshcoreMessage).mock.calls.length,
      ).toBeGreaterThan(0);
    });
    expect(vi.mocked(window.electronAPI.db.saveMeshcoreMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_idx: -1,
        reply_id: 77_777,
        payload: 'hi',
        to_node: PEER_NODE_ID,
      }),
    );
  });

  it('sends plain DM payload when replyId does not match any thread message', async () => {
    resetMocksAndBaseContacts([]);
    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
      },
    });

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreMessages).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.connect('serial');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    await act(async () => {
      await result.current.sendMessage('hi', 0, PEER_NODE_ID, 99_999);
    });

    expect(sendTextMessageMock).toHaveBeenCalledWith(pubKeyBytesFromHex(PEER_PUBKEY_HEX), 'hi');

    await waitFor(() => {
      expect(
        vi.mocked(window.electronAPI.db.saveMeshcoreMessage).mock.calls.length,
      ).toBeGreaterThan(0);
    });
    expect(vi.mocked(window.electronAPI.db.saveMeshcoreMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_idx: -1,
        reply_id: null,
        payload: 'hi',
      }),
    );
  });
});
