import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@liamcottle/meshcore.js', () => ({
  Connection: class {
    onConnected = vi.fn().mockResolvedValue(undefined);
    onFrameReceived = vi.fn();
    emit = vi.fn();
  },
  SerialConnection: class {
    close = vi.fn().mockResolvedValue(undefined);
  },
  WebSerialConnection: class {
    close = vi.fn().mockResolvedValue(undefined);
  },
  Constants: {},
}));

import { MeshcoreWebBluetoothConnection } from './meshcoreWebBluetoothConnection';
import type { TransportWebBluetoothIpc } from './transportWebBluetoothIpc';

function makeMockTransport(innerWritable: WritableStream<Uint8Array>) {
  return {
    toDevice: innerWritable,
    fromDevice: new ReadableStream(),
    requestDevice: vi.fn().mockResolvedValue({ deviceId: 'wb-test', deviceName: 'MeshCore' }),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  } as unknown as TransportWebBluetoothIpc;
}

describe('MeshcoreWebBluetoothConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serializes concurrent sendToRadioFrame writes after connect', async () => {
    let innerWriteCount = 0;
    const inner = new WritableStream<Uint8Array>({
      async write() {
        innerWriteCount++;
        await new Promise((resolve) => setTimeout(resolve, 15));
      },
    });
    const transport = makeMockTransport(inner);
    const conn = new MeshcoreWebBluetoothConnection(transport);

    await conn.connect();

    await Promise.all([
      conn.sendToRadioFrame(new Uint8Array([1])),
      conn.sendToRadioFrame(new Uint8Array([2])),
      conn.sendToRadioFrame(new Uint8Array([3])),
    ]);

    expect(innerWriteCount).toBe(3);
    expect(transport.toDevice).toBe(inner);
  });
});
