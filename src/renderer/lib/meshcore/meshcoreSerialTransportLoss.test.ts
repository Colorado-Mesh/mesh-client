import type { Connection } from '@liamcottle/meshcore.js';
import { describe, expect, it, vi } from 'vitest';

import {
  attachMeshcoreSerialTransportLossWatch,
  getSerialPortFromMeshcoreConnection,
  isWebSerialTransportLostError,
} from './meshcoreSerialTransportLoss';

type MeshcoreWritableConn = Connection & { writable: WritableStream<Uint8Array> };

function makeMockPort() {
  const handlers = new Map<string, EventListener>();
  const port = {
    addEventListener: vi.fn((type: string, handler: EventListener) => {
      handlers.set(type, handler);
    }),
    removeEventListener: vi.fn((type: string) => {
      handlers.delete(type);
    }),
    close: vi.fn(),
  } as unknown as SerialPort;
  return { port, handlers };
}

describe('meshcoreSerialTransportLoss', () => {
  it('isWebSerialTransportLostError is the same heuristic used by the Meshtastic detector', () => {
    const err = new DOMException('Failed to write: The device has been lost.', 'NetworkError');
    expect(isWebSerialTransportLostError(err)).toBe(true);
    expect(isWebSerialTransportLostError(new Error('Packet does not exist'))).toBe(false);
  });

  describe('getSerialPortFromMeshcoreConnection', () => {
    it('resolves a `port` property when it exposes close()', () => {
      const { port } = makeMockPort();
      expect(getSerialPortFromMeshcoreConnection({ port })).toBe(port);
    });

    it('falls back to a `connection` property when it exposes close()', () => {
      const { port } = makeMockPort();
      expect(getSerialPortFromMeshcoreConnection({ connection: port })).toBe(port);
    });

    it('prefers `port` over `connection` when both are present', () => {
      const { port: primary } = makeMockPort();
      const { port: secondary } = makeMockPort();
      expect(getSerialPortFromMeshcoreConnection({ port: primary, connection: secondary })).toBe(
        primary,
      );
    });

    it('returns null when neither property exposes a close() method', () => {
      expect(getSerialPortFromMeshcoreConnection({ port: {} })).toBeNull();
      expect(getSerialPortFromMeshcoreConnection({})).toBeNull();
      expect(getSerialPortFromMeshcoreConnection(null)).toBeNull();
      expect(getSerialPortFromMeshcoreConnection(undefined)).toBeNull();
    });
  });

  describe('attachMeshcoreSerialTransportLossWatch', () => {
    it('notifies once on a serial disconnect event', () => {
      const onLost = vi.fn();
      const { port, handlers } = makeMockPort();
      const inner = new WritableStream<Uint8Array>({ write: vi.fn() });
      const conn = { port, writable: inner } as unknown as MeshcoreWritableConn;

      attachMeshcoreSerialTransportLossWatch(conn, onLost);
      handlers.get('disconnect')?.(new Event('disconnect'));
      handlers.get('disconnect')?.(new Event('disconnect'));

      expect(onLost).toHaveBeenCalledTimes(1);
    });

    it('notifies once on a wrapped write failure', async () => {
      const onLost = vi.fn();
      const inner = new WritableStream<Uint8Array>({
        write() {
          throw new DOMException('The device has been lost.', 'NetworkError');
        },
      });
      const conn = { writable: inner } as unknown as MeshcoreWritableConn;

      attachMeshcoreSerialTransportLossWatch(conn, onLost);

      const writer = conn.writable.getWriter();
      await expect(writer.write(new Uint8Array([1]))).rejects.toBeInstanceOf(DOMException);
      expect(onLost).toHaveBeenCalledTimes(1);
    });

    it('does not double-notify when both disconnect and write failure fire', async () => {
      const onLost = vi.fn();
      const { port, handlers } = makeMockPort();
      const inner = new WritableStream<Uint8Array>({
        write() {
          throw new DOMException('The device has been lost.', 'NetworkError');
        },
      });
      const conn = { port, writable: inner } as unknown as MeshcoreWritableConn;

      attachMeshcoreSerialTransportLossWatch(conn, onLost);
      handlers.get('disconnect')?.(new Event('disconnect'));
      const writer = conn.writable.getWriter();
      await expect(writer.write(new Uint8Array([1]))).rejects.toBeInstanceOf(DOMException);

      expect(onLost).toHaveBeenCalledTimes(1);
    });

    it('wraps `writable` so concurrent getWriter() calls do not throw WritableStream is locked', async () => {
      let innerWriteCount = 0;
      const inner = new WritableStream<Uint8Array>({
        async write() {
          innerWriteCount++;
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
      });
      const conn = { writable: inner } as unknown as MeshcoreWritableConn;

      attachMeshcoreSerialTransportLossWatch(conn, vi.fn());

      const w1 = conn.writable.getWriter();
      const w2 = conn.writable.getWriter();
      await Promise.all([w1.write(new Uint8Array([1])), w2.write(new Uint8Array([2]))]);
      w1.releaseLock();
      w2.releaseLock();

      expect(innerWriteCount).toBe(2);
    });

    it('removes the disconnect listener and restores the port writable on cleanup', () => {
      // Cleanup restores from `port.writable` (the underlying hardware Web Serial port's own
      // getter), not from the conn's pre-wrap value — that is how real Web Serial connections
      // are wired (conn.writable === port.writable before wrapping).
      const { port, handlers } = makeMockPort();
      const portWritable = new WritableStream<Uint8Array>({ write: vi.fn() });
      (port as unknown as { writable: WritableStream<Uint8Array> }).writable = portWritable;
      const inner = new WritableStream<Uint8Array>({ write: vi.fn() });
      const conn = { port, writable: inner } as unknown as MeshcoreWritableConn;

      const detach = attachMeshcoreSerialTransportLossWatch(conn, vi.fn());
      expect(conn.writable).not.toBe(inner);

      detach();

      expect(port.removeEventListener).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(handlers.size).toBe(0);
      expect(conn.writable).toBe(portWritable);
    });

    it('is a no-op cleanup when there is no port and no writable stream', () => {
      const conn = {} as unknown as MeshcoreWritableConn;
      const detach = attachMeshcoreSerialTransportLossWatch(conn, vi.fn());
      expect(() => {
        detach();
      }).not.toThrow();
    });
  });
});
