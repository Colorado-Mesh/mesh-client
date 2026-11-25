/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeMeshcomBleCommand, MESHCOM_BLE_HELLO } from '@/renderer/lib/meshcom/meshcomBleFrame';
import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

vi.mock('../../bleReconnectHelper', () => ({
  connectGattWithScanBusyRetry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../connection', () => ({
  closeSerialPortIfOpen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../serialPortClaim', () => ({
  releaseConflictingSerialSessions: vi.fn().mockResolvedValue(undefined),
  logLoraSerialConnectedSnapshot: vi.fn(),
}));

vi.mock('../../serialPortRecovery', () => ({
  openSerialPortWithTimeout: vi.fn().mockResolvedValue(undefined),
}));

import { closeSerialPortIfOpen } from '../../connection';
import { releaseConflictingSerialSessions } from '../../serialPortClaim';
import { openSerialPortWithTimeout } from '../../serialPortRecovery';

vi.mock('../../serialPortSignature', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('../../serialPortSignature')>();
  return {
    ...actual,
    persistSerialPortIdentity: vi.fn(),
  };
});

vi.mock('../../meshtastic/meshtasticTransportLossDetection', () => ({
  createSerializedWritableStream: (inner: WritableStream<Uint8Array>) => inner,
}));

import { connectGattWithScanBusyRetry } from '../../bleReconnectHelper';
import { createMeshComConnection, transportParamsToMeshCom } from './MeshComTransport';

const connectGattWithScanBusyRetryMock = vi.mocked(connectGattWithScanBusyRetry);
const openMock = vi.mocked(openSerialPortWithTimeout);
const closeMock = vi.mocked(closeSerialPortIfOpen);

/** Keep read() pending so the serial read loop does not tear the port down mid-assert. */
function mockSerialPort(opts?: {
  portId?: string;
  usbVendorId?: number;
  usbProductId?: number;
}): SerialPort {
  return {
    readable: {
      getReader: () => ({
        read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {})),
        cancel: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn(),
      }),
    },
    writable: new WritableStream<Uint8Array>(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getInfo: () => ({
      usbVendorId: opts?.usbVendorId,
      usbProductId: opts?.usbProductId,
    }),
    portId: opts?.portId,
    open: vi.fn(),
    close: vi.fn(),
    forget: vi.fn(),
  } as unknown as SerialPort;
}

describe('MeshComTransport', () => {
  beforeEach(() => {
    window.electronAPI = createElectronAPIMock();
    connectGattWithScanBusyRetryMock.mockClear();
    connectGattWithScanBusyRetryMock.mockResolvedValue(undefined);
  });

  it('transportParamsToMeshCom maps serial, ble, http→tcp, and netconsole with auth', () => {
    expect(transportParamsToMeshCom({ type: 'serial', portSignature: 'port-1' })).toEqual({
      transport: 'serial',
      portSignature: 'port-1',
    });
    expect(transportParamsToMeshCom({ type: 'ble', peripheralId: 'aa:bb' })).toEqual({
      transport: 'ble',
      peripheralId: 'aa:bb',
    });
    expect(
      transportParamsToMeshCom({ type: 'http', host: '10.0.0.1' }, { authPassword: 'secret' }),
    ).toEqual({
      transport: 'tcp',
      host: '10.0.0.1',
      authPassword: 'secret',
    });
    expect(
      transportParamsToMeshCom(
        { type: 'netconsole', host: '10.0.0.2:2323' },
        { authPassword: 'pw' },
      ),
    ).toEqual({
      transport: 'netconsole',
      host: '10.0.0.2:2323',
      authPassword: 'pw',
    });
  });

  it('BLE connectGatt meshcom session, sends HELLO, and forwards fromRadio', async () => {
    const gattToRadio = vi.mocked(window.electronAPI.gattToRadio);
    gattToRadio.mockClear();

    let fromRadioCb: ((payload: { sessionId: string; bytes: Uint8Array }) => void) | undefined;
    vi.mocked(window.electronAPI.onGattFromRadio).mockImplementation((cb) => {
      fromRadioCb = cb as typeof fromRadioCb;
      return () => {};
    });
    vi.mocked(window.electronAPI.onGattDisconnected).mockReturnValue(() => {});

    const conn = await createMeshComConnection({
      transport: 'ble',
      peripheralId: 'meshcom-periph',
    });

    expect(connectGattWithScanBusyRetryMock).toHaveBeenCalledWith('meshcom', 'meshcom-periph');
    expect(gattToRadio).toHaveBeenCalledWith('meshcom', MESHCOM_BLE_HELLO);

    const onData = vi.fn();
    conn.onData = onData;
    const inbound = new Uint8Array([0x40, 0x68, 0x69]);
    fromRadioCb?.({ sessionId: 'meshcom', bytes: inbound });
    expect(onData).toHaveBeenCalledWith(inbound);

    await conn.write(new Uint8Array([0xa0, 1]));
    expect(gattToRadio).toHaveBeenCalledWith('meshcom', new Uint8Array([0xa0, 1]));

    const cmd = encodeMeshcomBleCommand('--info');
    await conn.write(new TextEncoder().encode('--info\r\n'));
    expect(gattToRadio).toHaveBeenCalledWith('meshcom', cmd);

    await conn.close();
    expect(window.electronAPI.disconnectGatt).toHaveBeenCalledWith('meshcom');
  });

  it('buffers fromRadio until Protocol.subscribe attaches onData', async () => {
    let fromRadioCb: ((payload: { sessionId: string; bytes: Uint8Array }) => void) | undefined;
    vi.mocked(window.electronAPI.onGattFromRadio).mockImplementation((cb) => {
      fromRadioCb = cb as typeof fromRadioCb;
      return () => {};
    });
    vi.mocked(window.electronAPI.onGattDisconnected).mockReturnValue(() => {});

    const conn = await createMeshComConnection({
      transport: 'ble',
      peripheralId: 'meshcom-periph',
    });

    const early = new TextEncoder().encode('D{"TYP":"I","CALL":"NV0N-20"}');
    fromRadioCb?.({ sessionId: 'meshcom', bytes: early });

    const onData = vi.fn();
    conn.onData = onData;
    expect(onData).toHaveBeenCalledTimes(1);
    const flushed = onData.mock.calls[0]?.[0] as Uint8Array;
    expect(Array.from(flushed)).toEqual(Array.from(early));
  });

  it('BLE requires peripheralId', async () => {
    await expect(createMeshComConnection({ transport: 'ble' })).rejects.toThrow(
      /peripheral ID required/i,
    );
  });

  it('serial opens Web Serial at 115200 and pipes readable chunks', async () => {
    openMock.mockClear();
    closeMock.mockClear();
    vi.mocked(releaseConflictingSerialSessions).mockClear();

    let releaseResolve: (() => void) | undefined;
    const releasePending = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    vi.mocked(releaseConflictingSerialSessions).mockImplementationOnce(() => releasePending);

    const written: Uint8Array[] = [];
    let readResolve: ((result: ReadableStreamReadResult<Uint8Array>) => void) | undefined;
    const reader = {
      read: vi.fn(
        () =>
          new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
            readResolve = resolve;
          }),
      ),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        written.push(chunk);
      },
    });
    const port = {
      readable: {
        getReader: () => reader,
      },
      writable,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getInfo: () => ({}),
      open: vi.fn(),
      close: vi.fn(),
      forget: vi.fn(),
    } as unknown as SerialPort;

    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
        getPorts: vi.fn().mockResolvedValue([]),
      },
    });

    const connectPromise = createMeshComConnection({ transport: 'serial' });
    await vi.waitFor(() => {
      expect(releaseConflictingSerialSessions).toHaveBeenCalledWith('meshcom', port);
    });
    expect(closeMock).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
    releaseResolve?.();
    const conn = await connectPromise;
    expect(closeMock).toHaveBeenCalledWith(port);
    expect(openMock).toHaveBeenCalledWith(port, 115200, 'MeshCom serial open');
    expect(conn.getSerialPort?.()).toBe(port);

    const onData = vi.fn();
    conn.onData = onData;
    const chunk = new Uint8Array([0x41, 0x42]);
    readResolve?.({ value: chunk, done: false });
    await vi.waitFor(() => {
      expect(onData).toHaveBeenCalledWith(chunk);
    });

    await conn.write(new Uint8Array([1, 2, 3]));
    expect(written).toEqual([new Uint8Array([1, 2, 3])]);

    readResolve?.({ value: undefined, done: true });
    await conn.close();
  });

  it('serial empty granted list falls back to requestPort when a saved identity exists', async () => {
    openMock.mockClear();

    const port = mockSerialPort({ portId: 'chosen' });
    const requestPort = vi.fn().mockResolvedValue(port);
    const getPorts = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort, getPorts },
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const conn = await createMeshComConnection({
      transport: 'serial',
      portSignature: 'saved-but-ungranted',
    });

    expect(getPorts).toHaveBeenCalled();
    expect(requestPort).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('mcL1503 [MeshComTransport] no granted serial ports'),
    );
    expect(openMock).toHaveBeenCalledWith(port, 115200, 'MeshCom serial open');
    expect(conn.getSerialPort?.()).toBe(port);
    await conn.close();
    warn.mockRestore();
  });

  it('serial no-match falls back to requestPort', async () => {
    openMock.mockClear();

    const other = mockSerialPort({ portId: 'other-device' });
    const port = mockSerialPort({ portId: 'chosen' });
    const requestPort = vi.fn().mockResolvedValue(port);
    const getPorts = vi.fn().mockResolvedValue([other]);
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort, getPorts },
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const conn = await createMeshComConnection({
      transport: 'serial',
      portSignature: 'stale-flasher-port',
    });

    expect(getPorts).toHaveBeenCalled();
    expect(requestPort).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('mcL1502 [MeshComTransport] no matching serial port'),
    );
    expect(openMock).toHaveBeenCalledWith(port, 115200, 'MeshCom serial open');
    expect(conn.getSerialPort?.()).toBe(port);
    await conn.close();
    warn.mockRestore();
  });

  it('serial matches MeshCom portId and ignores another granted device', async () => {
    openMock.mockClear();

    const meshcomPort = mockSerialPort({
      portId: 'meshcom-acm0',
      usbVendorId: 0x303a,
      usbProductId: 0x1001,
    });
    const otherProtocolPort = mockSerialPort({
      portId: 'flasher-port',
      usbVendorId: 4292,
      usbProductId: 60000,
    });
    const requestPort = vi.fn();
    const getPorts = vi.fn().mockResolvedValue([otherProtocolPort, meshcomPort]);
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort, getPorts },
    });

    const conn = await createMeshComConnection({
      transport: 'serial',
      portSignature: 'meshcom-acm0',
    });

    expect(requestPort).not.toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledWith(meshcomPort, 115200, 'MeshCom serial open');
    expect(conn.getSerialPort?.()).toBe(meshcomPort);
    await conn.close();
  });

  it('serial does not bind another granted device when MeshCom portId is missing', async () => {
    openMock.mockClear();

    const otherProtocolPort = mockSerialPort({
      portId: 'flasher-port',
      usbVendorId: 4292,
      usbProductId: 60000,
    });
    const chosen = mockSerialPort({ portId: 'user-picked' });
    const requestPort = vi.fn().mockResolvedValue(chosen);
    const getPorts = vi.fn().mockResolvedValue([otherProtocolPort]);
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort, getPorts },
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const conn = await createMeshComConnection({
      transport: 'serial',
      portSignature: 'meshcom-missing-id',
    });

    expect(requestPort).toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledWith(chosen, 115200, 'MeshCom serial open');
    expect(conn.getSerialPort?.()).toBe(chosen);
    await conn.close();
    warn.mockRestore();
  });
});
