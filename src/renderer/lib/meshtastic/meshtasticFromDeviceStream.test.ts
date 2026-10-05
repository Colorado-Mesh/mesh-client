import type { Types } from '@meshtastic/core';
import { Utils } from '@meshtastic/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function frame(payload: number[]): number[] {
  return [0x94, 0xc3, (payload.length >> 8) & 0xff, payload.length & 0xff, ...payload];
}

function payloadOf(length: number, seed: number): number[] {
  return Array.from({ length }, (_, i) => (seed + i * 7) % 0x90);
}

async function decode(chunks: number[][]): Promise<Types.DeviceOutput[]> {
  const framer = Utils.fromDeviceStream();
  const writer = framer.writable.getWriter();
  const outputs: Types.DeviceOutput[] = [];
  const drained = (async () => {
    const reader = framer.readable.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      outputs.push(value);
    }
  })();
  for (const chunk of chunks) {
    await writer.write(new Uint8Array(chunk));
  }
  await writer.close();
  await drained;
  return outputs;
}

function packets(outputs: Types.DeviceOutput[]): number[][] {
  return outputs.filter((o) => o.type === 'packet').map((o) => Array.from(o.data));
}

describe('@meshtastic/core fromDeviceStream (mesh-client patched framer)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a valid frame whose payload contains the 0x94 0xC3 magic intact', async () => {
    const payload = [0x12, 0x05, 0x94, 0xc3, 0x00, 0x10, 0x22];
    const outputs = await decode([frame(payload)]);
    expect(packets(outputs)).toEqual([payload]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('keeps decoding frames after a live packet that embeds magic + bogus length (log regression)', async () => {
    // Shape from the 2026-10-04 log: 60-byte FromRadio.packet (field 2 → 0x12) discarded as
    // "malformed", after which the old framer wedged waiting on a bogus inner length.
    const live = [0x12, 0x3a, ...payloadOf(50, 3), 0x94, 0xc3, 0x7f, 0xff, 0x01, 0x02, 0x03, 0x04];
    expect(live).toHaveLength(60);
    const next1 = payloadOf(20, 11);
    const next2 = payloadOf(33, 29);
    const outputs = await decode([frame(live), frame(next1), frame(next2)]);
    expect(packets(outputs)).toEqual([live, next1, next2]);
  });

  it('reassembles frames delivered one byte at a time', async () => {
    const a = payloadOf(10, 1);
    const b = [0x94, 0xc3, 0x01, 0x00];
    const bytes = [...frame(a), ...frame(b)];
    const outputs = await decode(bytes.map((byte) => [byte]));
    expect(packets(outputs)).toEqual([a, b]);
  });

  it('skips a stray 0x94 that is not followed by 0xC3', async () => {
    const a = payloadOf(8, 5);
    const outputs = await decode([[0x94, 0x41, ...frame(a)]]);
    expect(packets(outputs)).toEqual([a]);
  });

  it('resyncs past a header whose length exceeds the 512-byte firmware max', async () => {
    const a = payloadOf(16, 9);
    const outputs = await decode([[0x94, 0xc3, 0x02, 0x01, 0x55], frame(a)]);
    expect(packets(outputs)).toEqual([a]);
  });

  it('accepts a frame at exactly the 512-byte max', async () => {
    const a = payloadOf(512, 2);
    const outputs = await decode([frame(a)]);
    expect(packets(outputs)).toEqual([a]);
  });

  it('emits text before a frame header as a debug output', async () => {
    const text = Array.from(new TextEncoder().encode('INFO | boot\n'));
    const a = payloadOf(4, 7);
    const outputs = await decode([[...text, ...frame(a)]]);
    expect(outputs[0]).toEqual({ type: 'debug', data: 'INFO | boot\n' });
    expect(packets(outputs)).toEqual([a]);
  });
});
