import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./protocolRfAutoConnectGate', () => ({
  cancelProtocolRfAutoConnect: vi.fn(),
}));

vi.mock('./serialPortSignature', () => ({
  getPortSignature: vi.fn((port: SerialPort) => port.getInfo()),
  loadLastSerialPortSignature: vi.fn(() => null),
  signaturesEqual: vi.fn(
    (
      a: { usbVendorId?: number; usbProductId?: number; bluetoothServiceClassId?: string } | null,
      b: { usbVendorId?: number; usbProductId?: number; bluetoothServiceClassId?: string },
    ) => {
      if (!a) return false;
      return (
        a.usbVendorId === b.usbVendorId &&
        a.usbProductId === b.usbProductId &&
        (a.bluetoothServiceClassId ?? null) === (b.bluetoothServiceClassId ?? null)
      );
    },
  ),
}));

import { cancelProtocolRfAutoConnect } from './protocolRfAutoConnectGate';
import {
  registerMeshcomSerialDisconnectTarget,
  registerMeshcoreSerialDisconnectTarget,
  registerMeshtasticSerialDisconnectTarget,
} from './serialDisconnectRouter';
import {
  cancelAllLoraRfAutoConnect,
  listInAppSerialHolders,
  releaseConflictingSerialSessions,
  snapshotLoraSerialConnected,
} from './serialPortClaim';
import { loadLastSerialPortSignature } from './serialPortSignature';

function makePort(info: {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: string;
}): SerialPort {
  return {
    readable: null,
    writable: null,
    open: vi.fn(),
    close: vi.fn(),
    forget: vi.fn(),
    getInfo: () => info,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as SerialPort;
}

describe('serialPortClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMeshtasticSerialDisconnectTarget(null);
    registerMeshcoreSerialDisconnectTarget(null);
    registerMeshcomSerialDisconnectTarget(null);
    vi.mocked(loadLastSerialPortSignature).mockReturnValue(null);
  });

  afterEach(() => {
    registerMeshtasticSerialDisconnectTarget(null);
    registerMeshcoreSerialDisconnectTarget(null);
    registerMeshcomSerialDisconnectTarget(null);
  });

  it('snapshotLoraSerialConnected reports each registered LoRa hold', () => {
    expect(snapshotLoraSerialConnected()).toEqual({
      meshtastic: false,
      meshcore: false,
      meshcom: false,
    });
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      onDisconnected: vi.fn(),
    });
    registerMeshcomSerialDisconnectTarget({
      isSerialConnected: () => false,
      onDisconnected: vi.fn(),
    });
    expect(snapshotLoraSerialConnected()).toEqual({
      meshtastic: true,
      meshcore: false,
      meshcom: false,
    });
  });

  it('listInAppSerialHolders skips the claiming protocol and unmatched ports', () => {
    const shared = makePort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    const other = makePort({ usbVendorId: 0x1234, usbProductId: 0x5678 });
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      getOpenSerialPort: () => shared,
      onDisconnected: vi.fn(),
    });
    registerMeshcomSerialDisconnectTarget({
      isSerialConnected: () => true,
      getOpenSerialPort: () => other,
      onDisconnected: vi.fn(),
    });

    expect(listInAppSerialHolders('meshcore', null)).toEqual([]);
    expect(listInAppSerialHolders('meshcore', shared)).toEqual(['meshtastic']);
    expect(listInAppSerialHolders('meshtastic', shared)).toEqual([]);
  });

  it('releaseConflictingSerialSessions logs isSerialConnected before yield', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const shared = makePort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      getOpenSerialPort: () => shared,
      onDisconnected: vi.fn(),
      releaseHold: vi.fn().mockResolvedValue(undefined),
    });

    await releaseConflictingSerialSessions('meshcore', shared);

    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining(
        '[serialPortClaim] open for meshcore; isSerialConnected={"meshtastic":true,"meshcore":false,"meshcom":false}',
      ),
    );
    debug.mockRestore();
  });

  it('releaseConflictingSerialSessions releases a same-port holder and cancels its auto-connect', async () => {
    const shared = makePort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    const releaseHold = vi.fn().mockResolvedValue(undefined);
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      getOpenSerialPort: () => shared,
      onDisconnected: vi.fn(),
      releaseHold,
    });

    await releaseConflictingSerialSessions('meshcore', shared);

    expect(releaseHold).toHaveBeenCalledTimes(1);
    expect(cancelProtocolRfAutoConnect).toHaveBeenCalledWith('meshtastic');
  });

  it('releaseConflictingSerialSessions yields on matching USB signature without live port handle', async () => {
    const claim = makePort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    vi.mocked(loadLastSerialPortSignature).mockReturnValue({
      usbVendorId: 0x303a,
      usbProductId: 0x1001,
    });
    const releaseHold = vi.fn().mockResolvedValue(undefined);
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      onDisconnected: vi.fn(),
      releaseHold,
    });

    await releaseConflictingSerialSessions('meshcore', claim);

    expect(releaseHold).toHaveBeenCalledTimes(1);
    expect(cancelProtocolRfAutoConnect).toHaveBeenCalledWith('meshtastic');
  });

  it('MeshCom claim does not yield another protocol on shared USB signature alone', async () => {
    const claim = makePort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    vi.mocked(loadLastSerialPortSignature).mockReturnValue({
      usbVendorId: 0x303a,
      usbProductId: 0x1001,
    });
    const releaseHold = vi.fn().mockResolvedValue(undefined);
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      onDisconnected: vi.fn(),
      releaseHold,
    });

    await releaseConflictingSerialSessions('meshcom', claim);

    expect(releaseHold).not.toHaveBeenCalled();
    expect(cancelProtocolRfAutoConnect).not.toHaveBeenCalled();
  });

  it('releaseConflictingSerialSessions leaves a different USB device alone', async () => {
    const held = makePort({ usbVendorId: 0x1111, usbProductId: 0x2222 });
    const claim = makePort({ usbVendorId: 0x303a, usbProductId: 0x1001 });
    const releaseHold = vi.fn().mockResolvedValue(undefined);
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => true,
      getOpenSerialPort: () => held,
      onDisconnected: vi.fn(),
      releaseHold,
    });

    await releaseConflictingSerialSessions('meshcore', claim);

    expect(releaseHold).not.toHaveBeenCalled();
    expect(cancelProtocolRfAutoConnect).not.toHaveBeenCalled();
  });

  it('releaseConflictingSerialSessions skips the claiming protocol itself', async () => {
    const port = makePort({ usbVendorId: 1, usbProductId: 2 });
    const releaseHold = vi.fn().mockResolvedValue(undefined);
    registerMeshcoreSerialDisconnectTarget({
      isSerialConnected: () => true,
      getOpenSerialPort: () => port,
      onDisconnected: vi.fn(),
      releaseHold,
    });

    await releaseConflictingSerialSessions('meshcore', port);

    expect(releaseHold).not.toHaveBeenCalled();
  });

  it('releaseConflictingSerialSessions skips disconnected protocols', async () => {
    const port = makePort({ usbVendorId: 1, usbProductId: 2 });
    const releaseHold = vi.fn().mockResolvedValue(undefined);
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => false,
      getOpenSerialPort: () => port,
      onDisconnected: vi.fn(),
      releaseHold,
    });

    await releaseConflictingSerialSessions('meshcore', port);

    expect(releaseHold).not.toHaveBeenCalled();
  });

  it('cancelAllLoraRfAutoConnect cancels meshtastic, meshcore, and meshcom', () => {
    cancelAllLoraRfAutoConnect();
    expect(cancelProtocolRfAutoConnect).toHaveBeenCalledWith('meshtastic');
    expect(cancelProtocolRfAutoConnect).toHaveBeenCalledWith('meshcore');
    expect(cancelProtocolRfAutoConnect).toHaveBeenCalledWith('meshcom');
  });

  it('MeshCore claim releases Meshtastic before open would see a locked port (bundle regression)', async () => {
    // Reproduces developer-bundle timeline: Meshtastic auto-open holds COM2 streams;
    // MeshCore select then open must yield Meshtastic first or Chromium throws already-open.
    const shared = makePort({ usbVendorId: 12346, usbProductId: 4097 });
    let meshtasticStillHolding = true;
    const releaseHold = vi.fn(() => {
      meshtasticStillHolding = false;
      return Promise.resolve();
    });
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => meshtasticStillHolding,
      getOpenSerialPort: () => (meshtasticStillHolding ? shared : null),
      onDisconnected: vi.fn(),
      releaseHold,
    });

    const open = vi.fn(() => {
      if (meshtasticStillHolding) {
        return Promise.reject(
          new Error("Failed to execute 'open' on 'SerialPort': The port is already open."),
        );
      }
      return Promise.resolve();
    });

    await expect(open()).rejects.toThrow(/already open/);

    await releaseConflictingSerialSessions('meshcore', shared);
    expect(releaseHold).toHaveBeenCalledTimes(1);
    expect(meshtasticStillHolding).toBe(false);
    await expect(open()).resolves.toBeUndefined();
  });
});
