import type { Connection } from '@liamcottle/meshcore.js';
import { describe, expect, it, vi } from 'vitest';

import { patchMeshcoreWebSerialWritable } from './MeshCoreTransport';

describe('patchMeshcoreWebSerialWritable', () => {
  it('serializes concurrent getWriter calls like WebSerialConnection.write', async () => {
    let innerWriteCount = 0;
    const inner = new WritableStream<Uint8Array>({
      async write() {
        innerWriteCount++;
        await new Promise((resolve) => setTimeout(resolve, 15));
      },
    });
    const conn = { writable: inner } as Connection & { writable: WritableStream<Uint8Array> };

    patchMeshcoreWebSerialWritable(conn, inner);

    const writeLikeMeshcore = async (bytes: Uint8Array) => {
      const writer = conn.writable.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    };

    await Promise.all([
      writeLikeMeshcore(new Uint8Array([1])),
      writeLikeMeshcore(new Uint8Array([2])),
      writeLikeMeshcore(new Uint8Array([3])),
    ]);

    expect(innerWriteCount).toBe(3);
    expect(conn.writable).not.toBe(inner);
  });

  it('does not replace the raw port writable reference on the SerialPort', () => {
    const inner = new WritableStream<Uint8Array>({ write: vi.fn() });
    const port = { writable: inner } as unknown as SerialPort;
    const conn = { writable: inner } as Connection & { writable: WritableStream<Uint8Array> };

    patchMeshcoreWebSerialWritable(conn, inner);

    expect(port.writable).toBe(inner);
    expect(conn.writable).not.toBe(inner);
  });
});
