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

import { releaseConflictingSerialSessions } from '../../serialPortClaim';

vi.mock('../../serialPortSignature', () => ({
  persistSerialPortIdentity: vi.fn(),
  selectGrantedSerialPort: vi.fn(),
}));

vi.mock('../../meshtastic/meshtasticTransportLossDetection', () => ({
  createSerializedWritableStream: (inner: WritableStream<Uint8Array>) => inner,
}));

import { connectGattWithScanBusyRetry } from '../../bleReconnectHelper';
import { createMeshComConnection, transportParamsToMeshCom } from './MeshComTransport';

const connectGattWithScanBusyRetryMock = vi.mocked(connectGattWithScanBusyRetry);

describe('MeshComTransport', () => {
  beforeEach(() => {
    window.electronAPI = createElectronAPIMock();
    connectGattWithScanBusyRetryMock.mockClear();
    connectGattWithScanBusyRetryMock.mockResolvedValue(undefined);
  });

  it('transportParamsToMeshCom maps serial portSignature, ble peripheralId, and http→tcp', () => {
    expect(transportParamsToMeshCom({ type: 'serial', portSignature: 'port-1' })).toEqual({
      transport: 'serial',
      portSignature: 'port-1',
    });
    expect(transportParamsToMeshCom({ type: 'ble', peripheralId: 'aa:bb' })).toEqual({
      transport: 'ble',
      peripheralId: 'aa:bb',
    });
    expect(transportParamsToMeshCom({ type: 'http', host: '10.0.0.1' })).toEqual({
      transport: 'tcp',
      host: '10.0.0.1',
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
    const { openSerialPortWithTimeout } = await import('../../serialPortRecovery');
    const openMock = vi.mocked(openSerialPortWithTimeout);
    openMock.mockClear();

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

    const conn = await createMeshComConnection({ transport: 'serial' });
    expect(releaseConflictingSerialSessions).toHaveBeenCalledWith('meshcom', port);
    expect(openMock).toHaveBeenCalledWith(port, 115200, 'MeshCom serial open');
    expect(vi.mocked(releaseConflictingSerialSessions).mock.invocationCallOrder[0]).toBeLessThan(
      openMock.mock.invocationCallOrder[0],
    );

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
});
