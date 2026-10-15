import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildRunCliCommandFrame,
  classifyCliReply,
  isMeshcoreCompanionCliSupported,
  matchCliReplyFrame,
  type MeshcoreCompanionCliConnection,
  randomMeshcoreCliPrefix,
  runMeshcoreCompanionCli,
  stripCliValueMarker,
  validateMeshcoreCompanionCliCommand,
} from './meshcoreCompanionCli';

function replyFrame(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(body.length + 1);
  out[0] = 29;
  out.set(body, 1);
  return out;
}

function fakeConn(onSend?: (frame: Uint8Array, emit: (f: Uint8Array) => void) => void) {
  const listeners = new Set<(...args: unknown[]) => void>();
  const emit = (f: Uint8Array): void => {
    for (const l of [...listeners]) l(f);
  };
  const conn: MeshcoreCompanionCliConnection & { sent: Uint8Array[]; listenerCount(): number } = {
    sent: [],
    on: vi.fn((event: string | number, cb: (...args: unknown[]) => void) => {
      if (event === 'rx') listeners.add(cb);
    }),
    off: vi.fn((event: string | number, cb: (...args: unknown[]) => void) => {
      if (event === 'rx') listeners.delete(cb);
    }),
    sendToRadioFrame: vi.fn((frame: Uint8Array) => {
      conn.sent.push(frame);
      onSend?.(frame, emit);
      return Promise.resolve();
    }),
    listenerCount: () => listeners.size,
  };
  return { conn, emit };
}

function sentText(frame: Uint8Array): string {
  return new TextDecoder().decode(frame.subarray(1));
}

describe('meshcoreCompanionCli', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gates on companion protocol version 14', () => {
    expect(isMeshcoreCompanionCliSupported(13)).toBe(false);
    expect(isMeshcoreCompanionCliSupported(14)).toBe(true);
    expect(isMeshcoreCompanionCliSupported(null)).toBe(false);
    expect(isMeshcoreCompanionCliSupported(undefined)).toBe(false);
  });

  it('builds a CMD 66 frame with the reflected prefix', () => {
    const frame = buildRunCliCommandFrame('get wifi.ssid', 'ab');
    expect(frame[0]).toBe(66);
    expect(sentText(frame)).toBe('ab|get wifi.ssid');
  });

  it('rejects multi-line, empty and oversized commands', () => {
    expect(() => validateMeshcoreCompanionCliCommand('set name x\nreboot')).toThrow();
    expect(() => validateMeshcoreCompanionCliCommand('   ')).toThrow();
    expect(() => validateMeshcoreCompanionCliCommand('x'.repeat(151))).toThrow();
    expect(validateMeshcoreCompanionCliCommand('  ver')).toBe('ver');
    expect(validateMeshcoreCompanionCliCommand('set wifi.pwd pass ')).toBe('set wifi.pwd pass ');
  });

  it('generates two-character lowercase alphanumeric prefixes', () => {
    for (let i = 0; i < 50; i++) expect(randomMeshcoreCliPrefix()).toMatch(/^[a-z0-9]{2}$/);
  });

  it('matches only CLI reply frames with the same prefix', () => {
    expect(matchCliReplyFrame(replyFrame('ab|> 1'), 'ab')).toBe('> 1');
    expect(matchCliReplyFrame(replyFrame('zz|> 1'), 'ab')).toBeNull();
    expect(matchCliReplyFrame(Uint8Array.from([0]), 'ab')).toBeNull();
  });

  it('classifies Unknown command as unsupported and strips value markers', () => {
    expect(classifyCliReply('Unknown command').kind).toBe('unsupported');
    expect(classifyCliReply('> 0').kind).toBe('ok');
    expect(stripCliValueMarker('> 192.168.1.4')).toBe('192.168.1.4');
    expect(stripCliValueMarker('OK')).toBe('OK');
  });

  it('resolves with the prefixed reply and ignores other frames', async () => {
    const { conn } = fakeConn((frame, emit) => {
      const prefix = sentText(frame).slice(0, 2);
      queueMicrotask(() => {
        emit(replyFrame('ZZ|stray'));
        emit(Uint8Array.from([0]));
        emit(replyFrame(`${prefix}|> connected`));
      });
    });
    await expect(runMeshcoreCompanionCli(conn, 'get wifi.status')).resolves.toEqual({
      kind: 'ok',
      reply: '> connected',
    });
    expect(conn.listenerCount()).toBe(0);
  });

  it('serializes commands on the same connection', async () => {
    const { conn } = fakeConn((frame, emit) => {
      const text = sentText(frame);
      setTimeout(() => {
        emit(replyFrame(`${text.slice(0, 3)}${text.slice(3)}-reply`));
      }, 5);
    });
    const a = runMeshcoreCompanionCli(conn, 'ver');
    const b = runMeshcoreCompanionCli(conn, 'board');
    expect(conn.sent).toHaveLength(0);
    await expect(a).resolves.toMatchObject({ reply: 'ver-reply' });
    await expect(b).resolves.toMatchObject({ reply: 'board-reply' });
    expect(conn.sent.map((f) => sentText(f).slice(3))).toEqual(['ver', 'board']);
  });

  it('times out and keeps the queue usable', async () => {
    vi.useFakeTimers();
    let answer = false;
    const { conn } = fakeConn((frame, emit) => {
      if (answer) emit(replyFrame(`${sentText(frame).slice(0, 3)}OK`));
    });
    const first = runMeshcoreCompanionCli(conn, 'ver', { timeoutMs: 100 });
    const assertion = expect(first).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    answer = true;
    await expect(runMeshcoreCompanionCli(conn, 'ver')).resolves.toMatchObject({ reply: 'OK' });
    expect(conn.listenerCount()).toBe(0);
  });

  it('does not wait for a reply when expectNoReply is set', async () => {
    const { conn } = fakeConn();
    await expect(runMeshcoreCompanionCli(conn, 'reboot', { expectNoReply: true })).resolves.toEqual(
      { kind: 'ok', reply: '' },
    );
    expect(sentText(conn.sent[0]).slice(3)).toBe('reboot');
  });

  it('rejects when the frame write fails', async () => {
    const conn: MeshcoreCompanionCliConnection = {
      on: vi.fn(),
      off: vi.fn(),
      sendToRadioFrame: vi.fn().mockRejectedValue(new Error('link down')),
    };
    await expect(runMeshcoreCompanionCli(conn, 'ver')).rejects.toThrow('link down');
  });
});
