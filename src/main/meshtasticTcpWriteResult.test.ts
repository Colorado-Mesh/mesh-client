import net from 'node:net';

import { describe, expect, it } from 'vitest';

import { meshtasticTcpWriteErrorIsNoSocket } from './meshtasticTcpWriteResult';

describe('meshtasticTcpWriteErrorIsNoSocket', () => {
  it('treats a destroyed socket after the live-reference check as no-socket', () => {
    const sock = new net.Socket();
    sock.destroy();
    const err = new Error('This socket has been destroyed');
    expect(meshtasticTcpWriteErrorIsNoSocket(sock, err)).toBe(true);
  });

  it('treats writableEnded sockets and closed-stream codes as no-socket', () => {
    expect(
      meshtasticTcpWriteErrorIsNoSocket(
        { destroyed: false, writableEnded: true },
        new Error('write after end'),
      ),
    ).toBe(true);
    const epipe = new Error('write EPIPE') as NodeJS.ErrnoException;
    epipe.code = 'EPIPE';
    expect(
      meshtasticTcpWriteErrorIsNoSocket({ destroyed: false, writableEnded: false }, epipe),
    ).toBe(true);
  });

  it('propagates unrelated write failures on a live socket', () => {
    expect(
      meshtasticTcpWriteErrorIsNoSocket(
        { destroyed: false, writableEnded: false },
        new Error('EACCES: permission denied'),
      ),
    ).toBe(false);
  });
});
