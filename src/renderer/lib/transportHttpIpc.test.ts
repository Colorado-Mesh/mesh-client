import { describe, expect, it, vi } from 'vitest';

import { TransportHttpIpc } from './transportHttpIpc';

vi.mock('@/renderer/lib/reticulum/reticulumIpcDeadline', () => ({
  withReticulumIpcSendDeadline: (fn: (...args: any[]) => Promise<any>) => fn,
}));

describe('TransportHttpIpc', () => {
  it('exposes the device streams required by Types.Transport', () => {
    const transport = new TransportHttpIpc('http://example.com', false);
    expect(transport.toDevice).toBeInstanceOf(WritableStream);
    expect(transport.fromDevice).toBeInstanceOf(ReadableStream);
  });

  it('connects via IPC preflight and connect', async () => {
    const preflight = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);
    const write = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const onData = vi.fn(() => () => {});

    Object.assign(window, {
      electronAPI: {
        http: { preflight, connect, write, disconnect, onData },
      },
    });

    const transport = new TransportHttpIpc('http://example.com', false);
    await transport.connect();
    expect(preflight).toHaveBeenCalledWith('http://example.com', false);
    expect(connect).toHaveBeenCalledWith('http://example.com', false);
  });

  it('disconnects via IPC', async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    Object.assign(window, {
      electronAPI: {
        http: { disconnect, onData: () => () => {} },
      },
    });

    const transport = new TransportHttpIpc('http://example.com', false);
    await transport.disconnect();
    expect(disconnect).toHaveBeenCalled();
  });

  it('writes chunks to IPC', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.assign(window, {
      electronAPI: {
        http: {
          write,
          connect: () => Promise.resolve(),
          disconnect: () => Promise.resolve(),
          onData: () => () => {},
        },
      },
    });

    const transport = new TransportHttpIpc('http://example.com', false);
    const writer = transport.toDevice.getWriter();
    await writer.write(new Uint8Array([1, 2, 3]));
    writer.releaseLock();
    expect(write).toHaveBeenCalledWith([1, 2, 3]);
  });
});
