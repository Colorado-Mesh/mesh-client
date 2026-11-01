import { describe, expect, it, vi } from 'vitest';

import {
  chunkRemoteShellInput,
  createRemoteShellSender,
  decodeRemoteShellFrame,
  emptyRemoteShellFrame,
  encodeRemoteShellFrame,
  REMOTE_SHELL_MAX_PAYLOAD_BYTES,
} from './remoteShell';

describe('remoteShell codec', () => {
  it('round-trips a frame', () => {
    const frame = {
      ...emptyRemoteShellFrame('output', 0xdeadbeef),
      seq: 5,
      ackSeq: 3,
      payload: new TextEncoder().encode('hello'),
      cols: 80,
      rows: 24,
    };
    expect(decodeRemoteShellFrame(encodeRemoteShellFrame(frame))).toEqual(frame);
  });

  it('maps every op through the wire enum', () => {
    for (const op of [
      'open',
      'input',
      'resize',
      'close',
      'ping',
      'ack',
      'openOk',
      'output',
      'closed',
      'error',
      'pong',
    ] as const) {
      expect(decodeRemoteShellFrame(encodeRemoteShellFrame(emptyRemoteShellFrame(op, 1)))?.op).toBe(
        op,
      );
    }
  });

  it('uses the documented wire opcodes (OPEN=1, OPEN_OK=64)', () => {
    // field 1 (op) varint: tag 0x08
    expect(encodeRemoteShellFrame(emptyRemoteShellFrame('open', 0))[0]).toBe(0x08);
    expect(encodeRemoteShellFrame(emptyRemoteShellFrame('open', 0))[1]).toBe(1);
    expect(encodeRemoteShellFrame(emptyRemoteShellFrame('openOk', 0))[1]).toBe(64);
  });

  it('returns null for malformed bytes', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(decodeRemoteShellFrame(new Uint8Array([0x0a, 0xff, 0xff]))).toBeNull();
  });

  it('rejects oversize payloads and the unset op', () => {
    expect(() =>
      encodeRemoteShellFrame({
        ...emptyRemoteShellFrame('input', 1),
        payload: new Uint8Array(REMOTE_SHELL_MAX_PAYLOAD_BYTES + 1),
      }),
    ).toThrow(RangeError);
    expect(() => encodeRemoteShellFrame(emptyRemoteShellFrame('unset', 1))).toThrow(TypeError);
  });

  it('chunks input without splitting multi-byte code points', () => {
    const text = '€'.repeat(100); // 300 bytes
    const chunks = chunkRemoteShellInput(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(REMOTE_SHELL_MAX_PAYLOAD_BYTES);
    expect(chunks.map((c) => new TextDecoder().decode(c)).join('')).toBe(text);
  });
});

describe('createRemoteShellSender', () => {
  it('sends on REMOTE_SHELL_APP (13) to the node, primary channel, ack, no response', async () => {
    const sendPacket = vi.fn().mockResolvedValue(1);
    await createRemoteShellSender(() => ({ sendPacket }))(
      'id',
      0x1234,
      emptyRemoteShellFrame('ping', 9),
    );
    expect(sendPacket).toHaveBeenCalledWith(expect.any(Uint8Array), 13, 0x1234, 0, true, false);
  });

  it('throws when no radio handle', async () => {
    await expect(
      createRemoteShellSender(() => null)('id', 1, emptyRemoteShellFrame('ping', 1)),
    ).rejects.toThrow('not connected');
  });
});
