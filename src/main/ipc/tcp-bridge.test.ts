// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { FakeSocket, sockets } = vi.hoisted(() => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    destroyed = false;
    writableEnded = false;
    readableEnded = false;
    remoteAddress = '127.0.0.1';
    remotePort = 5000;
    connectPort: number | null = null;
    connectHost: string | null = null;
    private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    private connectListener: (() => void) | undefined;
    readonly setNoDelay = vi.fn();
    readonly setKeepAlive = vi.fn();
    readonly connect = vi.fn((port: number, host: string, cb?: () => void) => {
      this.connectPort = port;
      this.connectHost = host;
      this.connectListener = cb;
      return this;
    });
    readonly write = vi.fn((_data: Uint8Array, cb?: (err?: Error) => void) => {
      cb?.();
      return true;
    });
    destroy = vi.fn(() => {
      this.destroyed = true;
      this.emit('close', false);
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

    completeConnect(): void {
      this.connectListener?.();
    }
  }
  return { FakeSocket, sockets };
});

vi.mock('net', () => ({
  default: {
    Socket: FakeSocket,
  },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

vi.mock('../live-session-meter', () => ({
  clearLiveSessionMeter: vi.fn(),
  noteLiveSessionData: vi.fn(),
  noteLiveSessionWrite: vi.fn(),
  resetLiveSessionMeter: vi.fn(),
}));

vi.mock('../log-service', () => ({
  sanitizeLogMessage: (value: string) => value,
  logDeviceConnection: vi.fn(),
}));

import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';

import { noteLiveSessionData, noteLiveSessionWrite } from '../live-session-meter';
import { assertIpcSender } from '../validate-ipc-sender';
import {
  createTcpBridge,
  registerTcpBridgeIpcHandlers,
  TCP_BRIDGE_CONNECT_TIMEOUT_MS,
  TCP_BRIDGE_DATA_MAX_BYTES,
  TCP_BRIDGE_KEEPALIVE_INITIAL_DELAY_MS,
  TCP_BRIDGE_WRITE_MAX_BYTES,
} from './tcp-bridge';

const TCP_BRIDGE_SOURCE = readFileSync(join(__dirname, 'tcp-bridge.ts'), 'utf-8');
const event = {} as IpcMainInvokeEvent;

function validateHost(host: unknown): asserts host is string {
  if (typeof host !== 'string' || host.length === 0) {
    throw new Error('Invalid host');
  }
}

function latestSocket(): InstanceType<typeof FakeSocket> {
  const sock = sockets[sockets.length - 1];
  if (!sock) throw new Error('expected a FakeSocket');
  return sock;
}

describe('createTcpBridge', () => {
  const send = vi.fn();
  const getMainWindow = (): BrowserWindow =>
    ({ webContents: { send } }) as unknown as BrowserWindow;

  beforeEach(() => {
    sockets.length = 0;
    send.mockReset();
    vi.clearAllMocks();
    vi.mocked(assertIpcSender).mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('rejects MeshCore writes without a socket and returns no-socket for Meshtastic', async () => {
    const meshcore = createTcpBridge({
      protocol: 'meshcore',
      writeMissing: 'reject',
      getMainWindow,
      validateHost,
    });
    const meshtastic = createTcpBridge({
      protocol: 'meshtastic',
      writeMissing: 'no-socket',
      getMainWindow,
      validateHost,
    });

    await expect(meshcore.write(event, [1])).rejects.toThrow(
      'meshcore:tcp-write: no active socket',
    );
    expect(console.warn).toHaveBeenCalledWith('[IPC] meshcore:tcp-write: no active socket');
    expect(meshtastic.write(event, [1])).toBe('no-socket');
    expect(console.debug).toHaveBeenCalledWith('[IPC] meshtastic:tcp-write: no active socket');
  });

  it('keeps independent sockets so one protocol teardown does not affect the other', async () => {
    const meshcore = createTcpBridge({
      protocol: 'meshcore',
      writeMissing: 'reject',
      getMainWindow,
      validateHost,
    });
    const meshtastic = createTcpBridge({
      protocol: 'meshtastic',
      writeMissing: 'no-socket',
      getMainWindow,
      validateHost,
    });

    const meshcoreConnect = meshcore.connect(event, '10.0.0.1', 5000);
    const meshcoreSock = latestSocket();
    meshcoreSock.completeConnect();
    await meshcoreConnect;

    const meshtasticConnect = meshtastic.connect(event, '10.0.0.2', 4403);
    const meshtasticSock = latestSocket();
    meshtasticSock.completeConnect();
    await meshtasticConnect;

    meshcore.disconnect(event);
    await expect(meshtastic.write(event, [9])).resolves.toBeUndefined();
    expect(meshtasticSock.write).toHaveBeenCalled();
    await expect(meshcore.write(event, [9])).rejects.toThrow(
      'meshcore:tcp-write: no active socket',
    );
  });

  it('nulls the active ref before destroy so superseded closes do not emit disconnected', async () => {
    const bridge = createTcpBridge({
      protocol: 'meshcore',
      writeMissing: 'reject',
      getMainWindow,
      validateHost,
    });

    const first = bridge.connect(event, '192.168.1.8', 5000);
    const firstSock = latestSocket();
    firstSock.completeConnect();
    await first;

    const second = bridge.connect(event, '192.168.1.9', 5000);
    const secondSock = latestSocket();
    expect(firstSock.destroy).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalledWith('meshcore:tcp-disconnected');
    secondSock.completeConnect();
    await second;

    firstSock.emit('close', false);
    expect(send).not.toHaveBeenCalledWith('meshcore:tcp-disconnected');

    secondSock.emit('close', true);
    expect(send).toHaveBeenCalledWith('meshcore:tcp-disconnected');
  });

  it('does not emit tcp-data for oversized chunks and destroys the socket', async () => {
    const bridge = createTcpBridge({
      protocol: 'meshtastic',
      writeMissing: 'no-socket',
      getMainWindow,
      validateHost,
    });
    const connected = bridge.connect(event, '192.168.1.5', 4403);
    const sock = latestSocket();
    sock.completeConnect();
    await connected;

    sock.emit('data', Buffer.alloc(TCP_BRIDGE_DATA_MAX_BYTES + 1));
    expect(sock.destroy).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalledWith('meshtastic:tcp-data', expect.anything());
    expect(noteLiveSessionData).not.toHaveBeenCalled();
  });

  it('meters only the active socket and still fans out data from a live session', async () => {
    const bridge = createTcpBridge({
      protocol: 'meshcore',
      writeMissing: 'reject',
      getMainWindow,
      validateHost,
    });
    const connected = bridge.connect(event, '192.168.1.5', 5000);
    const sock = latestSocket();
    sock.completeConnect();
    await connected;

    sock.emit('data', Buffer.from([1, 2, 3]));
    expect(noteLiveSessionData).toHaveBeenCalledWith('meshcore');
    expect(send).toHaveBeenCalledWith('meshcore:tcp-data', new Uint8Array([1, 2, 3]));
  });

  it('enables TCP_NODELAY and keepalive, then times out a hung connect', async () => {
    vi.useFakeTimers();
    const bridge = createTcpBridge({
      protocol: 'meshtastic',
      writeMissing: 'no-socket',
      getMainWindow,
      validateHost,
    });
    const pending = bridge.connect(event, '192.168.1.5', 4403);
    const sock = latestSocket();
    expect(sock.setNoDelay).toHaveBeenCalledWith(true);
    expect(sock.setKeepAlive).toHaveBeenCalledWith(true, TCP_BRIDGE_KEEPALIVE_INITIAL_DELAY_MS);
    const expectation = expect(pending).rejects.toThrow(
      'meshtastic:tcp-connect: connection timeout',
    );
    await vi.advanceTimersByTimeAsync(TCP_BRIDGE_CONNECT_TIMEOUT_MS);
    await expectation;
    expect(sock.destroy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('returns no-socket for Meshtastic writes on a destroyed or classified-dead socket', async () => {
    const bridge = createTcpBridge({
      protocol: 'meshtastic',
      writeMissing: 'no-socket',
      getMainWindow,
      validateHost,
    });
    const connected = bridge.connect(event, '192.168.1.5', 4403);
    const sock = latestSocket();
    sock.completeConnect();
    await connected;

    sock.destroyed = true;
    expect(bridge.write(event, [1])).toBe('no-socket');

    sock.destroyed = false;
    sock.writableEnded = true;
    expect(bridge.write(event, [1])).toBe('no-socket');

    sock.writableEnded = false;
    sock.write.mockImplementationOnce((_data: Uint8Array, cb?: (err?: Error) => void) => {
      const err = new Error('write EPIPE') as NodeJS.ErrnoException;
      err.code = 'EPIPE';
      cb?.(err);
      return true;
    });
    await expect(bridge.write(event, [1])).resolves.toBe('no-socket');
  });

  it('rejects MeshCore write errors instead of mapping them to no-socket', async () => {
    const bridge = createTcpBridge({
      protocol: 'meshcore',
      writeMissing: 'reject',
      getMainWindow,
      validateHost,
    });
    const connected = bridge.connect(event, '192.168.1.5', 5000);
    const sock = latestSocket();
    sock.completeConnect();
    await connected;

    sock.write.mockImplementationOnce((_data: Uint8Array, cb?: (err?: Error) => void) => {
      const err = new Error('write EPIPE') as NodeJS.ErrnoException;
      err.code = 'EPIPE';
      cb?.(err);
      return true;
    });
    await expect(bridge.write(event, [1])).rejects.toThrow('write EPIPE');
    expect(noteLiveSessionWrite).not.toHaveBeenCalled();
  });

  it('rejects invalid ports, hosts, and write payloads before touching the socket', async () => {
    const bridge = createTcpBridge({
      protocol: 'meshcore',
      writeMissing: 'reject',
      getMainWindow,
      validateHost,
    });
    await expect(bridge.connect(event, '192.168.1.5', 0)).rejects.toThrow('Invalid port');
    await expect(bridge.connect(event, '', 5000)).rejects.toThrow('Invalid host');
    expect(sockets).toHaveLength(0);
    await expect(bridge.write(event, [256])).rejects.toThrow(
      'meshcore:tcp-write: byte values must be integers 0-255',
    );
    await expect(
      bridge.write(event, new Array(TCP_BRIDGE_WRITE_MAX_BYTES + 1).fill(1)),
    ).rejects.toThrow('invalid or oversized payload');
  });

  it('destroyForQuit tears down without emitting disconnected', async () => {
    const bridge = createTcpBridge({
      protocol: 'meshcore',
      writeMissing: 'reject',
      getMainWindow,
      validateHost,
    });
    const connected = bridge.connect(event, '192.168.1.5', 5000);
    const sock = latestSocket();
    sock.completeConnect();
    await connected;

    bridge.destroyForQuit('quitMainProcess TCP socket destroy (ignored)');
    expect(sock.destroy).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalledWith('meshcore:tcp-disconnected');
    await expect(bridge.write(event, [1])).rejects.toThrow('meshcore:tcp-write: no active socket');
  });

  it('does not null the active socket in the error handler so close can emit disconnected', async () => {
    const bridge = createTcpBridge({
      protocol: 'meshcore',
      writeMissing: 'reject',
      getMainWindow,
      validateHost,
    });
    const pending = bridge.connect(event, '192.168.1.5', 5000);
    const sock = latestSocket();
    const boom = new Error('ECONNRESET');
    sock.emit('error', boom);
    await expect(pending).rejects.toThrow('ECONNRESET');
    expect(send).not.toHaveBeenCalledWith('meshcore:tcp-disconnected');
    sock.emit('close', true);
    expect(send).toHaveBeenCalledWith('meshcore:tcp-disconnected');
  });
});

describe('registerTcpBridgeIpcHandlers', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('registers both protocol channel literals with assertIpcSender inside the shared handlers', () => {
    registerTcpBridgeIpcHandlers({
      getMainWindow: () => null,
      validateHost,
    });
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((call) => call[0]);
    expect(channels).toEqual([
      'meshcore:tcp-connect',
      'meshcore:tcp-write',
      'meshcore:tcp-disconnect',
      'meshtastic:tcp-connect',
      'meshtastic:tcp-write',
      'meshtastic:tcp-disconnect',
    ]);
    expect(TCP_BRIDGE_SOURCE).toContain("writeMissing: 'reject'");
    expect(TCP_BRIDGE_SOURCE).toContain("writeMissing: 'no-socket'");
    expect(TCP_BRIDGE_SOURCE).toContain('assertIpcSender(event, connectChannel)');
    expect(TCP_BRIDGE_SOURCE).toContain('assertIpcSender(event, writeChannel)');
    expect(TCP_BRIDGE_SOURCE).toContain('assertIpcSender(event, disconnectChannel)');
  });
});
