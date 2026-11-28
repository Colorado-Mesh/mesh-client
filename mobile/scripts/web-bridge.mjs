#!/usr/bin/env node
/**
 * MeshNet web bridge: the "native" side of the `MeshNet` Capacitor plugin for the mobile browser
 * harness and Playwright tests. It implements the plugin contract (TCP/TLS sockets, UDP, DNS,
 * streaming HTTP, WebSocket client) over a local WebSocket so the browser build can reach radios
 * (TCP/UDP), MQTT brokers, and HTTP APIs exactly like the Android/iOS plugins do.
 *
 * Listens on 127.0.0.1 only. Development/test tool — not shipped in any app.
 * Usage: node mobile/scripts/web-bridge.mjs [--port=47800]
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

import WebSocket, { WebSocketServer } from 'ws';

const b64 = (buf) => Buffer.from(buf).toString('base64');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Desktop sidecar build used as the harness's "native" Reticulum sidecar. */
export function resolveHarnessSidecarBinary() {
  const candidates = [
    process.env.MESH_SIDECAR_BIN,
    path.join(REPO_ROOT, 'reticulum-sidecar/target/release/mesh-client-reticulum'),
    path.join(REPO_ROOT, 'reticulum-sidecar/target/debug/mesh-client-reticulum'),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** Resolve `rel` inside `root`; rejects traversal and absolute paths. */
function underRoot(root, rel) {
  const resolved = path.resolve(root, rel ?? '');
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`EACCES path escapes the shared directory: ${rel}`);
  }
  return resolved;
}
const unb64 = (s) => Buffer.from(s ?? '', 'base64');

/**
 * Wire one bridge client: returns `handle(op, args)` and cleans up its resources on close.
 * @param {(event: string, data: unknown) => void} emit
 */
export function createBridgeSession(emit, { sharedDir, udpBindAddress } = {}) {
  const sockets = new Map();
  const procs = new Map();
  let sharedRoot = sharedDir ?? null;
  const ensureShared = () => {
    sharedRoot ??= fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-mobile-shared-'));
    return sharedRoot;
  };
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
      if (process.env.MESH_BRIDGE_DEBUG) {
        // The error text comes from the network peer: drop line breaks before it reaches a log.
        const reason = String(s.__err ?? '').replace(/\n|\r/g, '');
        console.debug(`[bridge] tcp ${id} closed ${reason}`);
      }
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
      // Test harness option: bind sockets that ask for every interface to one loopback address,
      // so a stand-in device can bind the same well-known port on another loopback address
      // (MeshCom EXTUDP uses 1799 on both ends). Native plugins never read this.
      const address =
        udpBindAddress && (a.address == null || a.address === '0.0.0.0')
          ? udpBindAddress
          : a.address;
      await new Promise((res, rej) => {
        s.once('error', rej);
        s.bind(a.port ?? 0, address, () => {
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
      // Node's fetch cannot connect to a chosen address: refuse a pinned request, as the
      // contract requires (resolving again would undo the host's public-address check).
      if (Object.keys(headers).some((k) => k.toLowerCase() === 'x-mesh-pinned-address')) {
        throw new Error('EPINUNSUPPORTED this bridge cannot connect to a pinned address');
      }
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
    // ── MeshProcess (Reticulum sidecar) ──
    async procInfo() {
      return { sidecarAvailable: resolveHarnessSidecarBinary() !== null };
    },
    async procSpawn(a) {
      const bin = resolveHarnessSidecarBinary();
      if (!bin || a.program !== 'reticulum-sidecar')
        throw new Error('ENOENT reticulum sidecar not available');
      const child = spawn(bin, a.args ?? [], {
        env: { ...process.env, ...(a.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      procs.set(a.id, child);
      child.stdout.on('data', (d) => emit('proc:stdout', { id: a.id, dataB64: b64(d) }));
      child.stderr.on('data', (d) => {
        if (process.env.MESH_BRIDGE_DEBUG) process.stderr.write(`[sidecar] ${d}`);
        emit('proc:stderr', { id: a.id, dataB64: b64(d) });
      });
      child.on('exit', (code, signal) => {
        if (process.env.MESH_BRIDGE_DEBUG)
          console.debug(`[bridge] sidecar exit code=${code} signal=${signal}`);
        procs.delete(a.id);
        emit('proc:exit', { id: a.id, code, signal });
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      return { pid: child.pid };
    },
    async procWriteStdin(a) {
      const c = procs.get(a.id);
      if (!c) throw new Error('EPIPE process not running');
      await new Promise((res, rej) => c.stdin.write(unb64(a.dataB64), (e) => (e ? rej(e) : res())));
      return {};
    },
    async procCloseStdin(a) {
      procs.get(a.id)?.stdin.end();
      return {};
    },
    async procKill(a) {
      procs.get(a.id)?.kill(a.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
      return {};
    },
    async sharedDir() {
      return { path: ensureShared() };
    },
    async sharedList(a) {
      const root = ensureShared();
      const base = underRoot(root, a.path);
      const files = [];
      const walk = (d) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.isFile()) {
            const st = fs.statSync(full);
            files.push({ path: path.relative(root, full), size: st.size, mtimeMs: st.mtimeMs });
          }
        }
      };
      walk(base);
      return { files };
    },
    async sharedRead(a) {
      return { dataB64: b64(fs.readFileSync(underRoot(ensureShared(), a.path))) };
    },
    async sharedWrite(a) {
      const target = underRoot(ensureShared(), a.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, unb64(a.dataB64));
      fs.renameSync(tmp, target);
      return {};
    },
    async sharedRemove(a) {
      fs.rmSync(underRoot(ensureShared(), a.path), { recursive: true, force: true });
      return {};
    },
  };

  return {
    async handle(op, args) {
      if (process.env.MESH_BRIDGE_DEBUG) {
        const redacted = JSON.stringify(args ?? {}, (k, v) =>
          k.toLowerCase() === 'authorization' || k === 'dataB64' ? '<redacted>' : v,
        );
        console.debug(`[bridge] ${op} ${redacted.slice(0, 200)}`);
      }
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
      for (const c of procs.values()) c.kill('SIGTERM');
    },
  };
}

/** Browser origins allowed to use the bridge: the local mobile harness / Vite dev server only. */
export function isAllowedBridgeOrigin(origin) {
  if (!origin) return true; // Node clients (tests) send no Origin header.
  try {
    const u = new URL(origin);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Start the bridge. Clients must present `?token=<token>` and, when they are browsers, a
 * loopback Origin — any other page open in the developer's browser cannot reach it, since
 * WebSockets are not subject to CORS.
 */
export function startMobileWebBridge({
  port = 47800,
  host = '127.0.0.1',
  token = randomBytes(24).toString('hex'),
  udpBindAddress = process.env.MESH_BRIDGE_UDP_BIND || undefined,
} = {}) {
  const server = new WebSocketServer({
    port,
    host,
    verifyClient: ({ origin, req }) => {
      const url = new URL(req.url ?? '/', 'ws://bridge');
      return url.searchParams.get('token') === token && isAllowedBridgeOrigin(origin);
    },
  });
  server.bridgeToken = token;
  server.on('connection', (client) => {
    const session = createBridgeSession(
      (event, data) => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ event, data }));
      },
      { udpBindAddress },
    );
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
  const server = startMobileWebBridge({ port });
  const url = `ws://127.0.0.1:${port}/?token=${server.bridgeToken}`;
  console.info(
    `MeshNet web bridge listening. In the mobile dev page run:\n  localStorage.setItem('mesh-mobile:web-bridge', '${url}')`,
  );
}
