import type { Connection } from '@liamcottle/meshcore.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const webSerialInstances: { writable: WritableStream<Uint8Array> }[] = [];

vi.mock('@liamcottle/meshcore.js', () => {
  class WebSerialConnection {
    writable: WritableStream<Uint8Array>;
    constructor(port: { writable: WritableStream<Uint8Array> }) {
      this.writable = port.writable;
      webSerialInstances.push(this);
    }
  }
  return {
    Connection: class {
      close = vi.fn();
    },
    WebSerialConnection,
    SerialConnection: class {
      close = vi.fn();
    },
  };
});

vi.mock('../../connection', () => ({
  closeSerialPortIfOpen: vi.fn().mockResolvedValue(undefined),
}));

import { patchMeshcoreWebSerialWritable, reconnectMeshcoreSerial } from './MeshCoreTransport';

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

describe('reconnectMeshcoreSerial writable patch', () => {
  const originalSerial = navigator.serial;

  beforeEach(() => {
    webSerialInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: originalSerial,
    });
  });

  it('patches WebSerialConnection.writable after openSerialPort', async () => {
    const portId = 'meshcore-serial-test';
    const innerWritable = new WritableStream<Uint8Array>({ write: vi.fn() });
    const port = {
      portId,
      writable: innerWritable,
      readable: new ReadableStream(),
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
    };

    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        getPorts: vi.fn().mockResolvedValue([port]),
      },
    });

    const conn = await reconnectMeshcoreSerial(portId);

    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(webSerialInstances).toHaveLength(1);
    const patched = webSerialInstances[0];
    expect(conn).toBe(patched);
    expect(patched.writable).not.toBe(innerWritable);
    expect(port.writable).toBe(innerWritable);
  });
});
