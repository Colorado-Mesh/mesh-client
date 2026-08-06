import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RNode, RNODE_BT_PAIRING_TIMEOUT_MS, RNODE_COMMAND_TIMEOUT_MS } from './rnode';

function createMockSerialPort(): {
  port: SerialPort;
  pushFromDevice: (bytes: Uint8Array) => void;
  written: Uint8Array[];
} {
  const written: Uint8Array[] = [];
  let readableController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      readableController = controller;
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(chunk);
    },
  });
  const port = {
    open: () => Promise.resolve(),
    close: () => {
      readableController?.close();
      return Promise.resolve();
    },
    get readable() {
      return readable;
    },
    get writable() {
      return writable;
    },
  } as unknown as SerialPort;
  return {
    port,
    written,
    pushFromDevice: (bytes) => {
      readableController?.enqueue(bytes);
    },
  };
}

describe('RNode command timeouts', () => {
  it('exports positive default KISS and BT pairing timeouts', () => {
    expect(RNODE_COMMAND_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(RNODE_BT_PAIRING_TIMEOUT_MS).toBeGreaterThan(RNODE_COMMAND_TIMEOUT_MS);
  });

  it('wires sendCommand timeout cleanup in source', async () => {
    const source = await import('./rnode?raw');
    expect(source.default).toContain('RNODE_COMMAND_TIMEOUT');
    expect(source.default).toContain('this.callbacks.delete(command)');
    expect(source.default).toContain('RNODE_BT_PAIRING_TIMEOUT_MS');
  });
});

describe('RNode WiFi payloads', () => {
  it('nullableStringPayload matches rnodeconf shapes', () => {
    expect(RNode.nullableStringPayload('')).toEqual([0]);
    expect(RNode.nullableStringPayload('RNode')).toEqual([...new TextEncoder().encode('RNode'), 0]);
  });

  it('ipv4Payload parses dotted quads', () => {
    expect(RNode.ipv4Payload('192.168.1.10')).toEqual([192, 168, 1, 10]);
    expect(() => RNode.ipv4Payload('bad')).toThrow('invalid IPv4 address');
  });
});

describe('RNode Bluetooth bond clear', () => {
  it('writes framed CMD_BT_UNPAIR 0x01 via clearBluetoothBonds', async () => {
    expect(RNode.CMD_BT_UNPAIR).toBe(0x70);
    const { port, written } = createMockSerialPort();
    const rnode = await RNode.fromSerialPort(port);
    await rnode.clearBluetoothBonds();
    const expected = RNode.createKissFrame([RNode.CMD_BT_UNPAIR, 0x01]);
    expect(
      written.some(
        (chunk) => chunk.length === expected.length && chunk.every((b, i) => b === expected[i]),
      ),
    ).toBe(true);
    await rnode.close();
  });
});

describe('RNode.startBluetoothPairing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the session open until CMD_BT_PIN arrives (not just the KISS write)', async () => {
    const { port, pushFromDevice, written } = createMockSerialPort();
    const rnode = await RNode.fromSerialPort(port);
    const onPin = vi.fn();

    const pairingPromise = rnode.startBluetoothPairing(onPin);

    // Allow the pairing KISS write to flush.
    await vi.advanceTimersByTimeAsync(0);
    expect(written.length).toBeGreaterThan(0);

    // PIN arrives later — promise must still be pending until then.
    let settled = false;
    void pairingPromise
      .then(() => {
        settled = true;
      })
      .catch(() => {
        // catch-no-log-ok: pairing may reject on timeout; test awaits pairingPromise below
      });
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);
    expect(onPin).not.toHaveBeenCalled();

    const pin = 123456;
    const pinBytes = [
      RNode.CMD_BT_PIN,
      (pin >>> 24) & 0xff,
      (pin >>> 16) & 0xff,
      (pin >>> 8) & 0xff,
      pin & 0xff,
    ];
    pushFromDevice(RNode.createKissFrame(pinBytes));
    await vi.advanceTimersByTimeAsync(0);
    await pairingPromise;

    expect(settled).toBe(true);
    expect(onPin).toHaveBeenCalledWith(pin);
    await rnode.close();
  });

  it('rejects when the pairing timeout elapses before CMD_BT_PIN', async () => {
    const { port } = createMockSerialPort();
    const rnode = await RNode.fromSerialPort(port);
    const pairingPromise = rnode.startBluetoothPairing(() => {});
    // Attach rejection handler before advancing timers (avoids unhandled rejection).
    const expectation = expect(pairingPromise).rejects.toThrow('RNODE_COMMAND_TIMEOUT');
    await vi.advanceTimersByTimeAsync(RNODE_BT_PAIRING_TIMEOUT_MS);
    await expectation;
    await rnode.close();
  });
});
