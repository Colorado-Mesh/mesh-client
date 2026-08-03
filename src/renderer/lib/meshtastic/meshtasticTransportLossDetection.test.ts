import type { MeshDevice } from '@meshtastic/core';
import { describe, expect, it, vi } from 'vitest';

import type { ConnectionType } from '../types';
import {
  attachMeshtasticTransportLossWatch,
  createSerializedWritableStream,
  isMeshtasticTransportLostError,
} from './meshtasticTransportLossDetection';

describe('meshtasticTransportLossDetection', () => {
  it('detects Web Serial device-lost NetworkError', () => {
    const err = new DOMException('Failed to write: The device has been lost.', 'NetworkError');
    expect(isMeshtasticTransportLostError(err)).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isMeshtasticTransportLostError(new Error('Packet does not exist'))).toBe(false);
  });

  it('detects Linux Web Bluetooth "Not connected" write failure', () => {
    expect(isMeshtasticTransportLostError(new Error('Not connected'))).toBe(true);
  });

  it('detects native Chromium GATT server disconnected NetworkError', () => {
    const err = new DOMException(
      "GATT Server is disconnected. Cannot perform GATT operations. (Re)connect first with 'device.gatt.connect'.",
      'NetworkError',
    );
    expect(isMeshtasticTransportLostError(err)).toBe(true);
  });

  it('notifies on serial disconnect event', () => {
    const onLost = vi.fn();
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

    const inner = new WritableStream<Uint8Array>({
      write: vi.fn(),
    });
    const device = {
      transport: {
        connection: port,
        toDevice: inner,
      },
    } as unknown as MeshDevice;

    attachMeshtasticTransportLossWatch(device, 'serial', onLost);
    handlers.get('disconnect')?.(new Event('disconnect'));

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent getWriter calls without WritableStream locked errors', async () => {
    let innerWriteCount = 0;
    const inner = new WritableStream<Uint8Array>({
      async write() {
        innerWriteCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
    const serialized = createSerializedWritableStream(inner);

    const w1 = serialized.getWriter();
    const w2 = serialized.getWriter();
    const p1 = w1.write(new Uint8Array([1]));
    const p2 = w2.write(new Uint8Array([2]));
    await Promise.all([p1, p2]);
    w1.releaseLock();
    w2.releaseLock();

    expect(innerWriteCount).toBe(2);
  });

  it('notifies on wrapped write failure', async () => {
    const onLost = vi.fn();
    const inner = new WritableStream<Uint8Array>({
      write() {
        throw new DOMException('The device has been lost.', 'NetworkError');
      },
    });
    const device = {
      transport: { toDevice: inner },
    } as unknown as MeshDevice;

    attachMeshtasticTransportLossWatch(device, 'serial', onLost);

    const writer = device.transport.toDevice.getWriter();
    await expect(writer.write(new Uint8Array([1]))).rejects.toBeInstanceOf(DOMException);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('createSerializedWritableStream rejects writes when inner stream is missing', async () => {
    const serialized = createSerializedWritableStream(undefined);
    const writer = serialized.getWriter();
    await expect(writer.write(new Uint8Array([1]))).rejects.toMatchObject({
      name: 'InvalidStateError',
    });
  });

  it('serializes concurrent getWriter calls for HTTP transport (regression)', async () => {
    // Meshtastic HTTP connect: MeshDevice's own Queue.processQueue() holds a writer
    // lock for the whole queue drain; a concurrent NODEINFO/GetMetadata retry calling
    // getWriter() on the same raw stream throws "WritableStream is locked" and the
    // write is silently dropped, leaving sent messages unacknowledged.
    let innerWriteCount = 0;
    const inner = new WritableStream<Uint8Array>({
      async write() {
        innerWriteCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
    const device = {
      transport: { toDevice: inner },
    } as unknown as MeshDevice;

    attachMeshtasticTransportLossWatch(device, 'http', vi.fn());

    const w1 = device.transport.toDevice.getWriter();
    const w2 = device.transport.toDevice.getWriter();
    await Promise.all([w1.write(new Uint8Array([1])), w2.write(new Uint8Array([2]))]);
    w1.releaseLock();
    w2.releaseLock();

    expect(innerWriteCount).toBe(2);
  });

  it('serializes concurrent getWriter calls for TCP transport (regression)', async () => {
    // Same SDK-level concurrency hazard as HTTP applies to Meshtastic's native TCP
    // streaming transport (port 4403) — it's yet another Types.Transport implementation.
    let innerWriteCount = 0;
    const inner = new WritableStream<Uint8Array>({
      async write() {
        innerWriteCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
    const device = {
      transport: { toDevice: inner },
    } as unknown as MeshDevice;

    attachMeshtasticTransportLossWatch(device, 'tcp', vi.fn());

    const w1 = device.transport.toDevice.getWriter();
    const w2 = device.transport.toDevice.getWriter();
    await Promise.all([w1.write(new Uint8Array([1])), w2.write(new Uint8Array([2]))]);
    w1.releaseLock();
    w2.releaseLock();

    expect(innerWriteCount).toBe(2);
  });

  it('does not wrap toDevice for unsupported connection types', () => {
    const inner = new WritableStream<Uint8Array>({ write: vi.fn() });
    const device = {
      transport: { toDevice: inner },
    } as unknown as MeshDevice;

    attachMeshtasticTransportLossWatch(device, 'reticulum' as unknown as ConnectionType, vi.fn());

    expect(device.transport.toDevice).toBe(inner);
  });

  it('restores toDevice on cleanup instead of deleting (getWriter race regression)', async () => {
    const inner = new WritableStream<Uint8Array>({
      write: vi.fn(),
    });
    const device = {
      transport: { toDevice: inner },
    } as unknown as MeshDevice;

    const detach = attachMeshtasticTransportLossWatch(device, 'ble', vi.fn());
    expect(device.transport.toDevice).not.toBe(inner);

    detach();

    // Must remain defined so in-flight SDK processQueue/getWriter does not throw.
    expect(device.transport.toDevice).toBeDefined();
    expect(typeof device.transport.toDevice.getWriter).toBe('function');
    const writer = device.transport.toDevice.getWriter();
    // Original stream may still accept writes after restore; close must not throw.
    await expect(writer.close()).resolves.toBeUndefined();
  });

  it('createSerializedWritableStream close soft-fails when inner is already closed', async () => {
    const inner = new WritableStream<Uint8Array>({ write: vi.fn() });
    await inner.close();
    const serialized = createSerializedWritableStream(inner);
    const writer = serialized.getWriter();
    await expect(writer.close()).resolves.toBeUndefined();
  });

  it('createSerializedWritableStream abort soft-fails when inner.abort rejects asynchronously', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const inner = new WritableStream<Uint8Array>({
        write: vi.fn(),
        abort() {
          return Promise.reject(new DOMException('already closed', 'InvalidStateError'));
        },
      });
      const serialized = createSerializedWritableStream(inner);
      const writer = serialized.getWriter();
      await expect(writer.abort('teardown')).resolves.toBeUndefined();
      // Allow any stray rejection to surface before asserting.
      await Promise.resolve();
      await Promise.resolve();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
