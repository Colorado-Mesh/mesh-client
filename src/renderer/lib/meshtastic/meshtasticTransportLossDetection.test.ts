import type { MeshDevice } from '@meshtastic/core';
import { describe, expect, it, vi } from 'vitest';

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
});
