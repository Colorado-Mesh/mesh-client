// @vitest-environment jsdom
import { MeshDevice } from '@meshtastic/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnect, mockDisconnect, lastTcpConnect } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockDisconnect: vi.fn(),
  lastTcpConnect: { host: '', port: 0 },
}));

vi.mock('@meshtastic/core', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('@meshtastic/core')>();
  return {
    ...actual,
    MeshDevice: class MockMeshDevice {
      constructor(public transport: unknown) {}
    },
  };
});

vi.mock('./transportTcpIpc', () => ({
  TransportTcpIpc: class MockTransportTcpIpc {
    constructor(
      public host: string,
      public port: number,
    ) {
      lastTcpConnect.host = host;
      lastTcpConnect.port = port;
    }

    connect = mockConnect;
    disconnect = mockDisconnect;
    toDevice = new WritableStream();
    fromDevice = new ReadableStream();
  },
}));

import { createConnection } from './connection';

describe('createConnection tcp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastTcpConnect.host = '';
    lastTcpConnect.port = 0;
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.log.logDeviceConnection).mockResolvedValue(undefined);
  });

  it('parses address with default port 4403 and connects TransportTcpIpc', async () => {
    const device = await createConnection('tcp', '192.168.1.50');
    expect(lastTcpConnect).toEqual({ host: '192.168.1.50', port: 4403 });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(device).toBeInstanceOf(MeshDevice);
  });

  it('uses explicit host:port from address', async () => {
    await createConnection('tcp', '10.0.0.8:4403');
    expect(lastTcpConnect).toEqual({ host: '10.0.0.8', port: 4403 });
  });

  it('disconnects transport when connect fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('connection refused'));
    await expect(createConnection('tcp', '192.168.1.50')).rejects.toThrow('connection refused');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects transport when connect times out', async () => {
    vi.useFakeTimers();
    try {
      mockConnect.mockImplementation(() => new Promise(() => {}));
      const connectPromise = createConnection('tcp', '192.168.1.50');
      const rejection = expect(connectPromise).rejects.toThrow(/timed out after 20s/);
      await vi.advanceTimersByTimeAsync(20_000);
      await rejection;
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires tcp address', async () => {
    await expect(createConnection('tcp', undefined)).rejects.toThrow('TCP address required');
  });
});
