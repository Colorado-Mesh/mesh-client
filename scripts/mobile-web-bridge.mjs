#!/usr/bin/env node
/**
 * MeshNet web bridge: the "native" side of the `MeshNet` Capacitor plugin for the mobile browser
 * harness and Playwright tests. It implements the plugin contract (TCP/TLS sockets, UDP, DNS,
 * streaming HTTP, WebSocket client) over a local WebSocket so the browser build can reach radios
 * (TCP/UDP), MQTT brokers, and HTTP APIs exactly like the Android/iOS plugins do.
 *
 * Listens on 127.0.0.1 only. Development/test tool — not shipped in any app.
 * Usage: node scripts/mobile-web-bridge.mjs [--port=47800]
 */
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import tls from 'node:tls';

import WebSocket, { WebSocketServer } from 'ws';

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => Buffer.from(s ?? '', 'base64');

/**
 * Wire one bridge client: returns `handle(op, args)` and cleans up its resources on close.
 * @param {(event: string, data: unknown) => void} emit
 */
export function createBridgeSession(emit) {
  const sockets = new Map();
  const servers = new Map();
  const udp = new Map();
  const http = new Map();
  const wss = new Map();

  function attachSocket(id, s) {
    sockets.set(id, s);
    s.on('data', (d) => emit('tcpData', { id, dataB64: b64(d) }));
    s.on('end', () => emit('tcpEnd', { id }));
    s.on('error', (e) => {
      s.__err = `${e.code ?? ''} ${e.message}`.trim();
    });
    s.on('close', () => {
      sockets.delete(id);
      emit('tcpClose', { id, error: s.__err });
    });
  }

  const ops = {
    async tcpConnect(a) {
      return await new Promise((resolve, reject) => {
        const opts = { host: a.host, port: a.port };
        const onErr = (e) => reject(new Error(`${e.code ?? ''} ${e.message}`.trim()));
        const s = a.tls
          ? tls.connect({
              ...opts,
              servername: a.servername && !net.isIP(a.servername) ? a.servername : undefined,
              rejectUnauthorized: a.rejectUnauthorized !== false,
              ca: a.caB64 ? [].concat(a.caB64).map((x) => unb64(x)) : undefined,
              cert: a.certB64 ? unb64(a.certB64) : undefined,
              key: a.keyB64 ? unb64(a.keyB64) : undefined,
            })
          : net.connect(opts);
        s.setNoDelay(a.noDelay !== false);
        if (a.keepAlive) s.setKeepAlive(true, a.keepAliveDelayMs ?? 0);
        s.once('error', onErr);
        s.once(a.tls ? 'secureConnect' : 'connect', () => {
          s.off('error', onErr);
          attachSocket(a.id, s);
          resolve({
            localAddress: s.localAddress,
            localPort: s.localPort,
            remoteAddress: s.remoteAddress,
            remotePort: s.remotePort,
            remoteFamily: s.remoteFamily,
            authorized: a.tls ? s.authorized : undefined,
          });
        });
      });
    },
    async tcpWrite(a) {
      const s = sockets.get(a.id);
      if (!s) throw new Error('EPIPE socket closed');
      await new Promise((res, rej) => s.write(unb64(a.dataB64), (e) => (e ? rej(e) : res())));
      return {};
    },
    async tcpEnd(a) {
      sockets.get(a.id)?.end();
      return {};
    },
    async tcpDestroy(a) {
      sockets.get(a.id)?.destroy();
      return {};
    },
    async tcpSetOptions(a) {
      const s = sockets.get(a.id);
      if (s && typeof a.noDelay === 'boolean') s.setNoDelay(a.noDelay);
      if (s && typeof a.keepAlive === 'boolean') s.setKeepAlive(a.keepAlive);
      return {};
    },
    async tcpListen(a) {
      return await new Promise((resolve, reject) => {
        const srv = net.createServer((s) => {
          const id = `${a.id}:${Math.random().toString(36).slice(2)}`;
          attachSocket(id, s);
          emit('tcpAccept', {
            serverId: a.id,
            id,
            remoteAddress: s.remoteAddress,
            remotePort: s.remotePort,
            localAddress: s.localAddress,
            localPort: s.localPort,
          });
        });
        srv.once('error', reject);
        srv.listen(a.port ?? 0, a.host ?? '127.0.0.1', () => {
          servers.set(a.id, srv);
          resolve({ port: srv.address().port, host: srv.address().address });
        });
      });
    },
    async tcpServerClose(a) {
      servers.get(a.id)?.close();
      servers.delete(a.id);
      return {};
    },
    async udpCreate(a) {
      const s = dgram.createSocket({ type: a.type ?? 'udp4', reuseAddr: Boolean(a.reuseAddr) });
      s.on('message', (m, r) =>
        emit('udpMessage', { id: a.id, dataB64: b64(m), address: r.address, port: r.port }),
      );
      s.on('error', (e) => emit('udpError', { id: a.id, message: e.message }));
      udp.set(a.id, s);
      return {};
    },
    async udpBind(a) {
      const s = udp.get(a.id);
      await new Promise((res, rej) => {
        s.once('error', rej);
        s.bind(a.port ?? 0, a.address, () => {
          s.off('error', rej);
          res();
        });
      });
      const ad = s.address();
      return { address: ad.address, port: ad.port };
    },
    async udpSend(a) {
      const s = udp.get(a.id);
      await new Promise((res, rej) =>
        s.send(unb64(a.dataB64), a.port, a.address, (e) => (e ? rej(e) : res())),
      );
      return {};
    },
    async udpClose(a) {
      udp.get(a.id)?.close();
      udp.delete(a.id);
      return {};
    },
    async udpSetOptions(a) {
      const s = udp.get(a.id);
      if (s && typeof a.broadcast === 'boolean') s.setBroadcast(a.broadcast);
      if (s && typeof a.multicastTtl === 'number') s.setMulticastTTL(a.multicastTtl);
      if (s && typeof a.multicastLoopback === 'boolean')
        s.setMulticastLoopback(a.multicastLoopback);
      return {};
    },
    async udpAddMembership(a) {
      udp.get(a.id)?.addMembership(a.group, a.iface);
      return {};
    },
    async udpDropMembership(a) {
      udp.get(a.id)?.dropMembership(a.group, a.iface);
      return {};
    },
    async dnsLookup(a) {
      const list = await dns.lookup(a.hostname, { all: true, family: a.family || 0 });
      return { addresses: list.map((x) => ({ address: x.address, family: x.family })) };
    },
    async httpRequest(a) {
      const ac = new AbortController();
      http.set(a.id, ac);
      const headers = { ...(a.headers ?? {}) };
      delete headers['x-mesh-pinned-address'];
      const r = await fetch(a.url, {
        method: a.method,
        headers,
        body: a.bodyB64 ? unb64(a.bodyB64) : undefined,
        redirect: a.followRedirects === false ? 'manual' : 'follow',
        signal: ac.signal,
      });
      const outHeaders = {};
      r.headers.forEach((v, k) => {
        outHeaders[k] = v;
      });
      void (async () => {
        try {
          if (r.body) {
            for await (const chunk of r.body) {
              if (ac.signal.aborted) return;
              emit('httpData', { id: a.id, dataB64: b64(chunk) });
            }
          }
          emit('httpEnd', { id: a.id });
        } catch (e) {
          emit('httpError', { id: a.id, message: e.message });
        } finally {
          http.delete(a.id);
        }
      })();
      return { status: r.status, statusText: r.statusText, headers: outHeaders, url: r.url };
    },
    async httpCancel(a) {
      http.get(a.id)?.abort();
      http.delete(a.id);
      return {};
    },
    async wsConnect(a) {
      const ws = new WebSocket(a.url, a.protocols?.length ? a.protocols : undefined, {
        headers: a.headers,
        handshakeTimeout: a.timeoutMs,
        rejectUnauthorized: a.rejectUnauthorized !== false,
      });
      wss.set(a.id, ws);
      ws.on('open', () => emit('wsOpen', { id: a.id, protocol: ws.protocol }));
      ws.on('message', (data, isBinary) =>
        emit(
          'wsMessage',
          isBinary ? { id: a.id, dataB64: b64(data) } : { id: a.id, text: data.toString('utf8') },
        ),
      );
      ws.on('close', (code, reason) => {
        wss.delete(a.id);
        emit('wsClose', { id: a.id, code, reason: reason.toString() });
      });
      ws.on('error', (e) => emit('wsError', { id: a.id, message: e.message }));
      return {};
    },
    async wsSend(a) {
      const ws = wss.get(a.id);
      if (!ws) throw new Error('WebSocket closed');
      ws.send(a.text !== undefined ? a.text : unb64(a.dataB64));
      return {};
    },
    async wsClose(a) {
      wss.get(a.id)?.close(a.code ?? 1000, a.reason ?? '');
      return {};
    },
  };

  return {
    async handle(op, args) {
      const fn = ops[op];
      if (!fn) throw new Error(`unknown op ${op}`);
      return await fn(args ?? {});
    },
    close() {
      for (const s of sockets.values()) s.destroy();
      for (const s of servers.values()) s.close();
      for (const s of udp.values()) s.close();
      for (const a of http.values()) a.abort();
      for (const w of wss.values()) w.terminate();
    },
  };
}

export function startMobileWebBridge({ port = 47800, host = '127.0.0.1' } = {}) {
  const server = new WebSocketServer({ port, host });
  server.on('connection', (client) => {
    const session = createBridgeSession((event, data) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ event, data }));
    });
    client.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        const value = await session.handle(msg.op, msg.args);
        client.send(JSON.stringify({ id: msg.id, ok: true, value }));
      } catch (e) {
        client.send(
          JSON.stringify({
            id: msg.id,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    });
    client.on('close', () => session.close());
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const portArg = process.argv.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.slice('--port='.length)) : 47800;
  startMobileWebBridge({ port });
  console.info(`MeshNet web bridge listening on ws://127.0.0.1:${port}`);
}
