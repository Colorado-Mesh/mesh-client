// fallow-ignore-file unused-class-member -- Capacitor invokes plugin methods by name (src/mobile/bridge/nativePlugins.ts)
/**
 * Browser implementation of the `MeshNet` plugin used by the mobile browser harness and
 * Playwright tests. Socket/HTTP/WebSocket/DNS operations are tunnelled as JSON over a WebSocket to
 * `scripts/mobile-web-bridge.mjs` (a Node process acting as the "native" side), so the exact
 * plugin contract the Android/iOS plugins implement is exercised end to end.
 *
 * Connection details: `webBridgeClient.ts`. Without a bridge, `httpRequest` falls back to `fetch`.
 */
import { WebPlugin } from '@capacitor/core';

import { bridgeClient } from './webBridgeClient';

const NET_EVENTS = [
  'tcpData',
  'tcpEnd',
  'tcpClose',
  'tcpAccept',
  'udpMessage',
  'udpError',
  'httpData',
  'httpEnd',
  'httpError',
  'wsOpen',
  'wsMessage',
  'wsClose',
  'wsError',
];

export class WebMeshNet extends WebPlugin {
  constructor() {
    super();
    for (const e of NET_EVENTS) {
      bridgeClient.on(e, (data) => {
        this.notifyListeners(e, data);
      });
    }
  }

  private call(op: string, args: unknown): Promise<unknown> {
    return bridgeClient.call(op, args);
  }

  tcpConnect(a: unknown) {
    return this.call('tcpConnect', a);
  }
  tcpWrite(a: unknown) {
    return this.call('tcpWrite', a);
  }
  tcpEnd(a: unknown) {
    return this.call('tcpEnd', a);
  }
  tcpDestroy(a: unknown) {
    return this.call('tcpDestroy', a);
  }
  tcpSetOptions(a: unknown) {
    return this.call('tcpSetOptions', a);
  }
  tcpListen(a: unknown) {
    return this.call('tcpListen', a);
  }
  tcpServerClose(a: unknown) {
    return this.call('tcpServerClose', a);
  }
  udpCreate(a: unknown) {
    return this.call('udpCreate', a);
  }
  udpBind(a: unknown) {
    return this.call('udpBind', a);
  }
  udpSend(a: unknown) {
    return this.call('udpSend', a);
  }
  udpClose(a: unknown) {
    return this.call('udpClose', a);
  }
  udpSetOptions(a: unknown) {
    return this.call('udpSetOptions', a);
  }
  udpAddMembership(a: unknown) {
    return this.call('udpAddMembership', a);
  }
  udpDropMembership(a: unknown) {
    return this.call('udpDropMembership', a);
  }
  dnsLookup(a: unknown) {
    return this.call('dnsLookup', a);
  }
  wsConnect(a: unknown) {
    return this.call('wsConnect', a);
  }
  wsSend(a: unknown) {
    return this.call('wsSend', a);
  }
  wsClose(a: unknown) {
    return this.call('wsClose', a);
  }
  httpCancel(a: unknown) {
    return this.call('httpCancel', a).catch(() => undefined);
  }

  async httpRequest(a: {
    id: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyB64?: string;
  }): Promise<unknown> {
    try {
      return await this.call('httpRequest', a);
    } catch (e) {
      if (!(e instanceof Error ? e.message : '').includes('bridge unavailable')) throw e;
      // No bridge: plain fetch (subject to CORS) streaming back through the same events.
      const body = a.bodyB64 ? Uint8Array.from(atob(a.bodyB64), (c) => c.charCodeAt(0)) : undefined;
      const r = await fetch(a.url, { method: a.method, headers: a.headers, body });
      const headers: Record<string, string> = {};
      r.headers.forEach((v, k) => {
        headers[k] = v;
      });
      void (async () => {
        try {
          const buf = new Uint8Array(await r.arrayBuffer());
          let s = '';
          for (let i = 0; i < buf.length; i += 0x8000)
            s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          if (buf.length) this.notifyListeners('httpData', { id: a.id, dataB64: btoa(s) });
          this.notifyListeners('httpEnd', { id: a.id });
        } catch (err) {
          this.notifyListeners('httpError', {
            id: a.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })();
      return { status: r.status, statusText: r.statusText, headers, url: r.url };
    }
  }
}
