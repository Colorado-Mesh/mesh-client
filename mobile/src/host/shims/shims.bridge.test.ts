/**
 * Host shims ↔ MeshNet contract, end to end: the Node-compatible `fetch`, `net`, `dgram`, `dns`
 * and `ws` shims the unmodified main process uses on mobile, driven through the host channel into
 * the reference MeshNet implementation (mobile/scripts/web-bridge.mjs) — the same contract the
 * Android and iOS plugins implement — against real local servers.
 */
import nodeDgram from 'node:dgram';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import nodeNet from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

import { connectHostToBridge } from '../testing/bridgeHost';
import { mobileFetch } from './nativeFetch';
import * as dgram from './node/dgram';
import * as dns from './node/dns';
import * as net from './node/net';
import WebSocketShim from './pkg/ws';

let bridge: { close(): void };
let httpServer: http.Server;
let httpBase: string;

beforeAll(async () => {
  bridge = await connectHostToBridge();
  httpServer = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/plain', 'x-test': 'yes' });
      res.write('one,');
      setTimeout(() => res.write('two,'), 20);
      setTimeout(() => res.end('three'), 40);
      return;
    }
    if (url === '/endless') {
      res.writeHead(200);
      const t = setInterval(() => res.write('x'.repeat(1024)), 10);
      res.on('close', () => {
        clearInterval(t);
      });
      return;
    }
    if (url === '/nocontent') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url === '/redirect') {
      res.writeHead(302, { location: '/stream' });
      res.end();
      return;
    }
    if (url === '/echo' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(201, { 'content-type': 'application/octet-stream' });
        res.end(Buffer.concat(chunks).reverse());
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  httpBase = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(() => {
  bridge.close();
  httpServer.closeAllConnections();
  httpServer.close();
});

describe('fetch over MeshNet', () => {
  it('streams a chunked body with status and headers', async () => {
    const r = await mobileFetch(`${httpBase}/stream`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-test')).toBe('yes');
    expect(await r.text()).toBe('one,two,three');
  });

  it('follows redirects and reports the final URL', async () => {
    const r = await mobileFetch(`${httpBase}/redirect`);
    expect(r.status).toBe(200);
    expect(r.url).toBe(`${httpBase}/stream`);
    expect(await r.text()).toBe('one,two,three');
  });

  it('handles 204 and HEAD without a body', async () => {
    const r = await mobileFetch(`${httpBase}/nocontent`);
    expect(r.status).toBe(204);
    expect(r.body).toBeNull();
    const h = await mobileFetch(`${httpBase}/stream`, { method: 'HEAD' });
    expect(h.status).toBe(200);
    expect(h.body).toBeNull();
  });

  it('sends a binary request body', async () => {
    const r = await mobileFetch(`${httpBase}/echo`, {
      method: 'POST',
      body: new Uint8Array([1, 2, 3, 250]),
    });
    expect(r.status).toBe(201);
    expect(Array.from(new Uint8Array(await r.arrayBuffer()))).toEqual([250, 3, 2, 1]);
  });

  it('aborts mid-stream', async () => {
    const ac = new AbortController();
    const r = await mobileFetch(`${httpBase}/endless`, { signal: ac.signal });
    const reader = r.body!.getReader();
    await reader.read();
    ac.abort();
    await expect(
      (async () => {
        for (;;) {
          const { done } = await reader.read();
          if (done) return 'done';
        }
      })(),
    ).rejects.toThrow(/abort/i);
  });

  it('rejects with TypeError when the host is unreachable', async () => {
    await expect(mobileFetch('http://127.0.0.1:1/')).rejects.toThrow(TypeError);
  });
});

describe('net over MeshNet', () => {
  it('connects, writes, receives, half-closes, and reports addresses', async () => {
    const server = nodeNet.createServer((s) => {
      s.on('data', (d: Buffer) => s.write(Buffer.concat([Buffer.from('echo:'), d])));
      s.on('end', () => s.end());
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    const sock = new net.Socket();
    const received: Buffer[] = [];
    sock.on('data', (d: Buffer) => received.push(d));
    await new Promise<void>((resolve) => sock.connect(port, '127.0.0.1', resolve));
    expect(sock.remotePort).toBe(port);
    expect(sock.remoteAddress).toBe('127.0.0.1');
    sock.write(Buffer.from([0x94, 0xc3, 0x00, 0x01, 0x2a]));
    await new Promise((r) => setTimeout(r, 100));
    expect(Buffer.concat(received)).toEqual(
      Buffer.concat([Buffer.from('echo:'), Buffer.from([0x94, 0xc3, 0x00, 0x01, 0x2a])]),
    );
    const closed = once(sock, 'close');
    sock.end();
    await closed;
    server.close();
  });

  it('surfaces ECONNREFUSED as err.code', async () => {
    const probe = nodeNet.createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = (probe.address() as AddressInfo).port;
    probe.close();
    await once(probe, 'close');
    const sock = net.createConnection(port, '127.0.0.1');
    const [err] = (await once(sock, 'error')) as [Error & { code?: string }];
    expect(err.code).toBe('ECONNREFUSED');
  });

  it('listens on an ephemeral port (sidecar port probing)', async () => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const addr = server.address();
    expect(addr?.port).toBeGreaterThan(0);
    await new Promise<void>((r) =>
      server.close(() => {
        r();
      }),
    );
  });
});

describe('dgram over MeshNet', () => {
  it('sends and receives UDP datagrams (MeshCom EXTUDP)', async () => {
    const peer = nodeDgram.createSocket('udp4');
    peer.on('message', (m, rinfo) => {
      peer.send(Buffer.concat([Buffer.from('ack:'), m]), rinfo.port, rinfo.address);
    });
    peer.bind(0, '127.0.0.1');
    await once(peer, 'listening');
    const sock = dgram.createSocket('udp4');
    sock.bind(0, '127.0.0.1');
    await once(sock, 'listening');
    expect(sock.address().port).toBeGreaterThan(0);
    const msg = once(sock, 'message');
    sock.send(Buffer.from('{"type":"msg"}'), peer.address().port, '127.0.0.1');
    const [data, rinfo] = (await msg) as [Buffer, { port: number }];
    expect(data.toString()).toBe('ack:{"type":"msg"}');
    expect(rinfo.port).toBe(peer.address().port);
    sock.close();
    peer.close();
  });
});

describe('dns over MeshNet', () => {
  it('resolves names and reports ENOTFOUND', async () => {
    const r = (await dns.promises.lookup('localhost')) as { address: string; family: number };
    expect(r.address).toMatch(/^(127\.0\.0\.1|::1)$/);
    await expect(dns.promises.lookup('does-not-exist.invalid')).rejects.toMatchObject({
      code: expect.stringMatching(/ENOTFOUND|EAI_AGAIN/) as unknown,
    });
  });
});

describe('ws over MeshNet', () => {
  it('connects with custom headers (sidecar bearer token) and exchanges messages', async () => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(wss, 'listening');
    let auth = '';
    wss.on('connection', (client, req) => {
      auth = req.headers.authorization ?? '';
      client.on('message', (data, isBinary) => {
        client.send(data, { binary: isBinary });
      });
    });
    const port = (wss.address() as AddressInfo).port;
    const ws = new WebSocketShim(`ws://127.0.0.1:${port}/api/v1/ws`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    await once(ws, 'open');
    expect(auth).toBe('Bearer test-token');
    const textMsg = once(ws, 'message');
    ws.send('{"type":"ping"}');
    const [text, isBinary] = (await textMsg) as [Buffer, boolean];
    expect(isBinary).toBe(false);
    expect(text.toString()).toBe('{"type":"ping"}');
    const binMsg = once(ws, 'message');
    ws.send(new Uint8Array([1, 2, 3]));
    const [bin, binFlag] = (await binMsg) as [Buffer, boolean];
    expect(binFlag).toBe(true);
    expect(Array.from(bin)).toEqual([1, 2, 3]);
    const closed = once(ws, 'close');
    ws.close(1000, 'bye');
    const [code] = (await closed) as [number];
    expect(code).toBe(1000);
    wss.close();
  });
});
