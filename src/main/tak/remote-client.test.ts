// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import tls from 'node:tls';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../log-service', async () => {
  const { sanitizeLogMessage } = await import('../sanitize-log-message');
  return { sanitizeLogMessage };
});

import type { TAKRemoteStatus } from '../../shared/tak-types';
import { createTakTestPki, type TakTestPki } from '../fixtures/tak-test-pki';
import {
  describeTakRemoteError,
  TAK_REMOTE_MAX_BUFFERED_BYTES,
  TAK_REMOTE_RECONNECT_BASE_MS,
  TAK_REMOTE_RECONNECT_MAX_MS,
  TAK_REMOTE_STABLE_MS,
  TakRemoteClient,
  type TakRemoteClientOptions,
} from './remote-client';

let pki: TakTestPki;

beforeAll(() => {
  pki = createTakTestPki();
});

function waitForStatus(
  client: TakRemoteClient,
  match: (s: TAKRemoteStatus) => boolean,
): Promise<TAKRemoteStatus> {
  if (match(client.getStatus())) return Promise.resolve(client.getStatus());
  return new Promise((resolve) => {
    const onStatus = (s: TAKRemoteStatus) => {
      if (!match(s)) return;
      client.off('status', onStatus);
      resolve(s);
    };
    client.on('status', onStatus);
  });
}

describe('TakRemoteClient over loopback TLS', () => {
  const servers: tls.Server[] = [];
  const clients: TakRemoteClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.stop();
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => {
              resolve();
            });
          }),
      ),
    );
  });

  /**
   * TAK-style mTLS server. `tcpConnections` counts accepted TCP connections: with TLS 1.3 the
   * client can finish its handshake before the server's secure-connection callback runs.
   */
  async function startServer(onSocket?: (socket: tls.TLSSocket) => void) {
    const received: string[] = [];
    const sockets: tls.TLSSocket[] = [];
    const counts = { tcpConnections: 0 };
    const server = tls.createServer(
      {
        key: pki.server.keyPem,
        cert: pki.server.certPem,
        ca: pki.ca.certPem,
        requestCert: true,
        rejectUnauthorized: true,
      },
      (socket) => {
        sockets.push(socket);
        socket.setEncoding('utf-8');
        socket.on('data', (chunk: string) => {
          received.push(chunk);
        });
        socket.on('error', () => {
          // client resets during teardown are expected
        });
        onSocket?.(socket);
      },
    );
    server.on('connection', () => {
      counts.tcpConnections++;
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    return { port: (server.address() as AddressInfo).port, received, sockets, counts };
  }

  function client(port: number, overrides: Partial<TakRemoteClientOptions> = {}) {
    const c = new TakRemoteClient({
      host: '127.0.0.1',
      port,
      verifyServer: true,
      credentials: { ca: pki.ca.certPem, cert: pki.client.certPem, key: pki.client.keyPem },
      ...overrides,
    });
    clients.push(c);
    return c;
  }

  it('connects with mTLS to a server whose certificate names a different host', async () => {
    const { port, received } = await startServer();
    const c = client(port);
    const connected = new Promise<void>((resolve) => c.once('connected', resolve));
    c.start();
    await connected;

    expect(c.getStatus()).toMatchObject({ state: 'connected', host: '127.0.0.1', port });
    expect(c.write('<event uid="MESH-1"/>')).toBe(true);
    await vi.waitFor(() => {
      expect(received.join('')).toBe('<event uid="MESH-1"/>\n');
    });
  });

  it('does not trust a server when no CA was imported', async () => {
    const { port } = await startServer();
    const c = client(port, {
      credentials: { cert: pki.client.certPem, key: pki.client.keyPem },
    });
    c.start();
    const status = await waitForStatus(c, (s) => s.error !== undefined);
    expect(status.state).toBe('connecting');
    expect(status.error).toMatch(/certificate/i);
  });

  it('reconnects after the server drops the stream', async () => {
    let dropped = false;
    const { port, counts } = await startServer((socket) => {
      if (dropped) return;
      dropped = true;
      setTimeout(() => socket.destroy(), 50);
    });
    const c = client(port);
    c.start();
    await waitForStatus(c, (s) => s.state === 'connected');
    await waitForStatus(c, (s) => s.state === 'connecting');
    await waitForStatus(c, (s) => s.state === 'connected');
    expect(counts.tcpConnections).toBe(2);
  }, 10_000);

  it('does not reconnect after stop()', async () => {
    const { port, counts } = await startServer();
    const c = client(port);
    c.start();
    await waitForStatus(c, (s) => s.state === 'connected');
    c.stop();
    expect(c.getStatus().state).toBe('disconnected');
    await new Promise((resolve) => setTimeout(resolve, TAK_REMOTE_RECONNECT_BASE_MS + 500));
    expect(counts.tcpConnections).toBe(1);
  }, 10_000);

  it('explains a server that requires a client certificate', async () => {
    const { port } = await startServer();
    const c = client(port, { credentials: { ca: pki.ca.certPem } });
    c.start();
    const status = await waitForStatus(c, (s) => s.error !== undefined);
    expect(status.error).toMatch(/client certificate/);
  });

  it('reports unusable credentials without throwing or retrying', () => {
    const c = client(1, { credentials: { cert: 'not a pem', key: 'not a pem' } });
    expect(() => {
      c.start();
    }).not.toThrow();
    expect(c.getStatus().state).toBe('disconnected');
    expect(c.getStatus().error).toBeTruthy();
  });
});

/** Minimal TLSSocket double for timing-sensitive paths. */
function fakeSocket() {
  const socket = Object.assign(new EventEmitter(), {
    writableLength: 0,
    written: [] as string[],
    setTimeout: vi.fn(),
    setKeepAlive: vi.fn(),
    resume: vi.fn(),
    write(data: string) {
      socket.written.push(data);
      return true;
    },
    destroy: vi.fn((err?: Error) => {
      if (err) socket.emit('error', err);
      socket.emit('close');
    }),
  });
  return socket;
}

describe('TakRemoteClient reconnect and output', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function withFakeSockets() {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const connect = vi.fn(() => {
      const s = fakeSocket();
      sockets.push(s);
      return s as unknown as tls.TLSSocket;
    });
    const c = new TakRemoteClient(
      { host: 'tak.example.org', port: 8089, verifyServer: true, credentials: {} },
      connect,
    );
    return { c, sockets, connect };
  }

  it('backs off exponentially up to the cap', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { c, sockets, connect } = withFakeSockets();
    c.start();

    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      sockets.at(-1)?.emit('close');
      const before = connect.mock.calls.length;
      let waited = 0;
      while (connect.mock.calls.length === before) {
        vi.advanceTimersByTime(TAK_REMOTE_RECONNECT_BASE_MS);
        waited += TAK_REMOTE_RECONNECT_BASE_MS;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(Math.max(...delays)).toBe(TAK_REMOTE_RECONNECT_MAX_MS);
    c.stop();
  });

  it('resets the backoff once a stream has stayed up', () => {
    vi.useFakeTimers();
    const { c, sockets, connect } = withFakeSockets();
    c.start();
    sockets.at(-1)?.emit('close');
    vi.advanceTimersByTime(TAK_REMOTE_RECONNECT_BASE_MS);
    sockets.at(-1)?.emit('close');
    vi.advanceTimersByTime(2 * TAK_REMOTE_RECONNECT_BASE_MS);
    sockets.at(-1)?.emit('secureConnect');
    vi.advanceTimersByTime(TAK_REMOTE_STABLE_MS);
    sockets.at(-1)?.emit('close');
    const before = connect.mock.calls.length;
    vi.advanceTimersByTime(TAK_REMOTE_RECONNECT_BASE_MS);
    expect(connect.mock.calls.length).toBe(before + 1);
    c.stop();
  });

  it('keeps backing off when the server drops each stream right after the handshake', () => {
    vi.useFakeTimers();
    const { c, sockets, connect } = withFakeSockets();
    c.start();
    // Attempts 1 and 2 fail outright; attempt 3 completes the handshake and is closed at once,
    // which is how a TLS 1.3 server rejects a client certificate.
    sockets.at(-1)?.emit('close');
    vi.advanceTimersByTime(TAK_REMOTE_RECONNECT_BASE_MS);
    sockets.at(-1)?.emit('close');
    vi.advanceTimersByTime(2 * TAK_REMOTE_RECONNECT_BASE_MS);
    sockets.at(-1)?.emit('secureConnect');
    sockets.at(-1)?.emit('close');

    expect(c.getStatus().error).toMatch(/right after the TLS handshake/);
    const before = connect.mock.calls.length;
    vi.advanceTimersByTime(4 * TAK_REMOTE_RECONNECT_BASE_MS - 1);
    expect(connect.mock.calls.length).toBe(before);
    vi.advanceTimersByTime(1);
    expect(connect.mock.calls.length).toBe(before + 1);
    c.stop();
  });

  it('strips CR/LF from socket errors before logging and status', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { c, sockets } = withFakeSockets();
    c.start();
    sockets[0]?.emit('error', new Error('boom\r\ninjected'));
    sockets[0]?.emit('close');
    expect(c.getStatus().error).not.toMatch(/[\r\n]/);
    for (const call of warn.mock.calls) expect(String(call[0])).not.toMatch(/[\r\n]/);
    c.stop();
  });

  it('writes newline-terminated CoT only while connected, and drops it when backed up', () => {
    const { c, sockets } = withFakeSockets();
    c.start();
    expect(c.write('<event/>')).toBe(false);
    sockets[0]?.emit('secureConnect');
    expect(c.write('<event/>')).toBe(true);
    expect(sockets[0]?.written).toEqual(['<event/>\n']);

    if (sockets[0]) sockets[0].writableLength = TAK_REMOTE_MAX_BUFFERED_BYTES + 1;
    expect(c.write('<event/>')).toBe(false);
    c.stop();
  });

  it('times out a handshake that never completes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { c, sockets } = withFakeSockets();
    c.start();
    sockets[0]?.emit('timeout');
    expect(sockets[0]?.destroy).toHaveBeenCalledWith(expect.any(Error));
    expect(c.getStatus()).toMatchObject({ state: 'connecting', error: 'connection timed out' });
    c.stop();
  });
});

describe('describeTakRemoteError', () => {
  function err(message: string, code?: string): NodeJS.ErrnoException {
    return Object.assign(new Error(message), code ? { code } : {});
  }

  it.each([
    ['ECONNREFUSED', /refused/],
    ['ENOTFOUND', /not found/],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', /import the server's CA/],
    ['ERR_TLS_CERT_ALTNAME_INVALID', /not for this address/],
  ])('describes %s', (code, text) => {
    expect(describeTakRemoteError(err('raw', code))).toMatch(text);
  });

  it('reduces an OpenSSL error to its reason', () => {
    const openssl =
      '80A15EED01000000:error:0A00045C:SSL routines:ssl3_read_bytes:tlsv13 alert certificate required:../deps/openssl/ssl/record/rec_layer_s3.c:916:SSL alert number 116';
    expect(describeTakRemoteError(err(openssl))).toBe(
      'The server requires a client certificate; import one',
    );
    expect(
      describeTakRemoteError(
        err('1:error:0A000418:SSL routines:ssl3_read_bytes:tlsv1 alert unknown ca:x.c:1'),
      ),
    ).toBe('The server rejected the client certificate (tlsv1 alert unknown ca)');
  });

  it('passes other messages through', () => {
    expect(describeTakRemoteError(err('socket hang up'))).toBe('socket hang up');
  });
});
