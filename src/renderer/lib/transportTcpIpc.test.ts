// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransportTcpIpc } from './transportTcpIpc';

describe('TransportTcpIpc', () => {
  let onDataCallback: ((bytes: Uint8Array) => void) | null = null;
  let onDisconnectedCallback: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    onDataCallback = null;
    onDisconnectedCallback = null;
    vi.mocked(window.electronAPI.meshtastic.tcp.onData).mockImplementation((cb) => {
      onDataCallback = cb;
      return () => {
        onDataCallback = null;
      };
    });
    vi.mocked(window.electronAPI.meshtastic.tcp.onDisconnected).mockImplementation((cb) => {
      onDisconnectedCallback = cb;
      return () => {
        onDisconnectedCallback = null;
      };
    });
  });

  it('connect() calls electronAPI.meshtastic.tcp.connect with host and port', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    await transport.connect();
    expect(window.electronAPI.meshtastic.tcp.connect).toHaveBeenCalledWith('192.168.200.4', 4403);
  });

  it('frames outbound writes with 0x94 0xc3 magic + big-endian length', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    const writer = transport.toDevice.getWriter();
    await writer.write(new Uint8Array([1, 2, 3]));
    writer.releaseLock();

    expect(window.electronAPI.meshtastic.tcp.write).toHaveBeenCalledTimes(1);
    const sentBytes = vi.mocked(window.electronAPI.meshtastic.tcp.write).mock.calls[0][0];
    expect(sentBytes).toEqual([0x94, 0xc3, 0, 3, 1, 2, 3]);
  });

  it('parses a complete framed message delivered via onData into a packet', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    expect(onDataCallback).not.toBeNull();

    const reader = transport.fromDevice.getReader();
    onDataCallback?.(new Uint8Array([0x94, 0xc3, 0, 2, 0xaa, 0xbb]));

    const { value } = await reader.read();
    expect(value).toEqual({ type: 'packet', data: new Uint8Array([0xaa, 0xbb]) });
    reader.releaseLock();
  });

  it('reassembles a message split across two onData calls', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    const reader = transport.fromDevice.getReader();

    onDataCallback?.(new Uint8Array([0x94, 0xc3, 0, 3, 0x01]));
    onDataCallback?.(new Uint8Array([0x02, 0x03]));

    const { value } = await reader.read();
    expect(value).toEqual({ type: 'packet', data: new Uint8Array([0x01, 0x02, 0x03]) });
    reader.releaseLock();
  });

  it('onDisconnected closes the fromDevice stream', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    const reader = transport.fromDevice.getReader();
    expect(onDisconnectedCallback).not.toBeNull();

    onDisconnectedCallback?.();

    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  it('toDevice.write rejects when meshtastic tcp-write has no active socket', async () => {
    vi.mocked(window.electronAPI.meshtastic.tcp.write).mockRejectedValueOnce(
      new Error('meshtastic:tcp-write: no active socket'),
    );
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    const writer = transport.toDevice.getWriter();
    await expect(writer.write(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      'meshtastic:tcp-write: no active socket',
    );
    writer.releaseLock();
  });

  it('disconnect() calls the IPC disconnect and is safe to call twice', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    await transport.disconnect();
    await transport.disconnect();
    expect(window.electronAPI.meshtastic.tcp.disconnect).toHaveBeenCalledTimes(2);
  });
});
