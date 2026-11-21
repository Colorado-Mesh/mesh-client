// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { FakeSocket, sockets } = vi.hoisted(() => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    bindPort: number | null = null;
    readonly bind = vi.fn((port: number, cb?: () => void) => {
      this.bindPort = port;
      cb?.();
    });
    connected: { port: number; host: string } | null = null;
    readonly connect = vi.fn((port: number, host: string, cb?: () => void) => {
      this.connected = { port, host };
      cb?.();
    });
    readonly send = vi.fn(
      (_msg: Buffer, _port: number, _host: string, cb?: (err?: Error | null) => void) => {
        cb?.(null);
      },
    );
    readonly close = vi.fn(() => {
      this.emit('close');
    });
    readonly once = vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      this.on(event, fn);
      return this;
    });
    readonly removeAllListeners = vi.fn((event?: string) => {
      if (event) this.listeners.delete(event);
      else this.listeners.clear();
      return this;
    });

    constructor() {
      sockets.push(this);
    }

    on(event: string, fn: (...args: unknown[]) => void): this {
      const list = this.listeners.get(event) ?? [];
      list.push(fn);
      this.listeners.set(event, list);
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      for (const fn of this.listeners.get(event) ?? []) fn(...args);
      return true;
    }
  }
  return { FakeSocket, sockets };
});

vi.mock('node:dgram', () => ({
  default: {
    createSocket: () => new FakeSocket(),
  },
}));

vi.mock('node:dns', () => ({
  default: {
    promises: {
      lookup: vi.fn(() => Promise.resolve({ address: '192.168.1.20', family: 4 })),
    },
  },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

vi.mock('../log-service', () => ({
  sanitizeLogMessage: (value: string) => value,
}));

import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';

import { MESHCOM_EXTUDP_PORT } from '../../shared/meshcomConstants';
import { assertIpcSender } from '../validate-ipc-sender';
import {
  createUdpBridge,
  registerUdpBridgeIpcHandlers,
  UDP_BRIDGE_WRITE_MAX_BYTES,
} from './udp-bridge';

const event = {} as IpcMainInvokeEvent;
const validateHost = (host: unknown): asserts host is string => {
  if (typeof host !== 'string' || !host) throw new Error('Invalid host');
};

describe('createUdpBridge', () => {
  beforeEach(() => {
    sockets.length = 0;
    vi.mocked(assertIpcSender).mockClear();
  });

  afterEach(() => {
    sockets.length = 0;
  });

  it('connect binds EXTUDP port and write sends to remote:1799', async () => {
    const send = vi.fn();
    const bridge = createUdpBridge({
      getMainWindow: () =>
        ({
          webContents: { send },
        }) as never,
      validateHost,
    });

    await bridge.connect(event, 'radio.local');
    expect(assertIpcSender).toHaveBeenCalledWith(event, 'meshcom:udp-connect');
    expect(sockets).toHaveLength(1);
    expect(sockets[0].bindPort).toBe(MESHCOM_EXTUDP_PORT);
    expect(sockets[0].connect).toHaveBeenCalledWith(MESHCOM_EXTUDP_PORT, '192.168.1.20');
    expect(sockets[0].connected).toEqual({ port: MESHCOM_EXTUDP_PORT, host: '192.168.1.20' });

    await bridge.write(event, [0x7b, 0x7d]);
    expect(sockets[0].send).toHaveBeenCalledWith(
      Buffer.from([0x7b, 0x7d]),
      MESHCOM_EXTUDP_PORT,
      '192.168.1.20',
      expect.any(Function),
    );

    const msgHandler = sockets[0];
    msgHandler.emit('message', Buffer.from('{"type":"msg"}'), {
      address: '192.168.1.20',
      port: MESHCOM_EXTUDP_PORT,
    });
    expect(send).toHaveBeenCalledWith(
      'meshcom:udp-data',
      Array.from(Buffer.from('{"type":"msg"}')),
    );
  });

  it('rate-limits rejected-peer debug logs under datagram flood', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const bridge = createUdpBridge({
      getMainWindow: () =>
        ({
          webContents: { send: vi.fn() },
        }) as never,
      validateHost,
    });
    await bridge.connect(event, '192.168.1.10');
    const sock = sockets[0];
    for (let i = 0; i < 50; i++) {
      sock.emit('message', Buffer.from('x'), {
        address: '10.0.0.99',
        port: MESHCOM_EXTUDP_PORT,
      });
    }
    const ignoreLogs = debug.mock.calls.filter((c) =>
      String(c[0] ?? '').includes('meshcom:udp-data ignore from'),
    );
    expect(ignoreLogs.length).toBe(1);
    debug.mockRestore();
  });

  it('rejects oversized writes', async () => {
    const bridge = createUdpBridge({
      getMainWindow: () => null,
      validateHost,
    });
    await bridge.connect(event, '127.0.0.1');
    await expect(
      bridge.write(event, new Array(UDP_BRIDGE_WRITE_MAX_BYTES + 1).fill(1)),
    ).rejects.toThrow(/oversized/);
  });
});

describe('registerUdpBridgeIpcHandlers', () => {
  it('registers meshcom udp channel literals', () => {
    vi.mocked(ipcMain.handle).mockClear();
    registerUdpBridgeIpcHandlers({
      getMainWindow: () => null,
      validateHost,
    });
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((call) => call[0]);
    expect(channels).toEqual([
      'meshcom:udp-connect',
      'meshcom:udp-write',
      'meshcom:udp-disconnect',
    ]);
  });
});
