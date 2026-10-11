import { fileURLToPath } from 'node:url';

import { WebSocket, WebSocketServer } from 'ws';

export const BEACON_PREVIEW_PATH = '/__mesh-client-beacon-preview';
/**
 * Loaded through the dev server, not a static import: the Vite config loader would otherwise
 * bundle the TypeScript source tree as CommonJS (unsupported by `configLoader: 'native'`).
 */
export const BEACON_FEED_MODULE = fileURLToPath(
  new URL('../src/main/beacon-feed.ts', import.meta.url),
);
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Browser-origin and local-socket checks apply before accepting any developer-preview peer. */
export function isBeaconPreviewRequestAllowed(request, port) {
  if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress)) return false;
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    const url = new URL(origin);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      LOOPBACK_NAMES.has(url.hostname) &&
      url.origin === origin &&
      url.host === host &&
      Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === port
    );
  } catch {
    // catch-no-log-ok malformed upgrade origins are rejected before accepting the peer
    return false;
  }
}

/** One native read-only feed belongs to each accepted preview browser connection. */
export function attachBeaconPreviewPeer(socket, createClient) {
  let connecting = false;
  let closed = false;
  const send = (message) => {
    if (closed || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 8 * 1024 * 1024) {
      socket.close(1013, 'Preview consumer is too slow');
      return;
    }
    socket.send(JSON.stringify(message));
  };
  const client = createClient((update) => send({ type: 'update', update }));
  const cleanup = () => {
    if (closed) return;
    closed = true;
    client.disconnect();
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
  socket.on('message', (data, binary) => {
    if (closed) return;
    let message;
    try {
      if (binary || data.length > 4096) throw new Error('Invalid preview request');
      message = JSON.parse(data.toString());
    } catch {
      // catch-no-log-ok invalid bounded preview messages close their connection
      socket.close(1008, 'Invalid preview request');
      return;
    }
    if (
      !message ||
      !Number.isSafeInteger(message.id) ||
      message.id < 1 ||
      !['connect', 'disconnect'].includes(message.type)
    ) {
      socket.close(1008, 'Invalid preview request');
      return;
    }
    if (message.type === 'disconnect') {
      client.disconnect();
      send({ type: 'response', id: message.id, ok: true });
      return;
    }
    const request = message.request;
    if (
      !request ||
      typeof request.baseUrl !== 'string' ||
      request.baseUrl.length > 2048 ||
      (request.provider !== undefined && !['beacon', 'corescope'].includes(request.provider)) ||
      (request.region !== undefined &&
        (typeof request.region !== 'string' || request.region.length > 128))
    ) {
      send({ type: 'response', id: message.id, ok: false, error: 'Invalid Beacon request' });
      return;
    }
    if (connecting) {
      send({
        type: 'response',
        id: message.id,
        ok: false,
        error: 'A connection is already pending',
      });
      return;
    }
    connecting = true;
    void client
      .connect({
        baseUrl: request.baseUrl,
        region: request.region,
        ...(request.provider === undefined ? {} : { provider: request.provider }),
      })
      .then(
        () => {
          connecting = false;
          send({ type: 'response', id: message.id, ok: true });
        },
        (error) => {
          connecting = false;
          send({
            type: 'response',
            id: message.id,
            ok: false,
            error:
              error instanceof Error ? error.message.slice(0, 512) : 'Beacon connection failed',
          });
        },
      );
  });
  return cleanup;
}

export function beaconPreviewPlugin() {
  let stop = () => {};
  return {
    name: 'mesh-client-beacon-preview',
    apply: 'serve',
    closeBundle() {
      stop();
    },
    configureServer(server) {
      if (!server.httpServer) return;
      const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 4096 });
      const peers = new Map();
      let feedModule;
      const loadFeedModule = () => {
        feedModule ??= server.ssrLoadModule(BEACON_FEED_MODULE).catch((error) => {
          feedModule = undefined;
          throw error;
        });
        return feedModule;
      };
      webSocketServer.on('connection', (socket, _request, BeaconFeedClient) => {
        const cleanup = attachBeaconPreviewPeer(
          socket,
          (onUpdate) => new BeaconFeedClient(onUpdate),
        );
        peers.set(socket, cleanup);
        socket.once('close', () => peers.delete(socket));
      });
      const upgrade = async (request, socket, head) => {
        if (request.url !== BEACON_PREVIEW_PATH) return;
        const address = server.httpServer.address();
        if (
          !address ||
          typeof address === 'string' ||
          !isBeaconPreviewRequestAllowed(request, address.port)
        ) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          return;
        }
        if (peers.size >= 4) {
          socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
          return;
        }
        let BeaconFeedClient;
        try {
          ({ BeaconFeedClient } = await loadFeedModule());
        } catch (error) {
          console.error('[beacon-preview] failed to load Beacon feed module', error);
          socket.end('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
          return;
        }
        if (socket.destroyed) return;
        webSocketServer.handleUpgrade(request, socket, head, (peer) => {
          webSocketServer.emit('connection', peer, request, BeaconFeedClient);
        });
      };
      server.httpServer.on('upgrade', upgrade);
      stop = () => {
        server.httpServer.off('upgrade', upgrade);
        for (const [peer, cleanup] of peers) {
          cleanup();
          peer.terminate();
        }
        peers.clear();
        webSocketServer.close();
        stop = () => {};
      };
      server.httpServer.once('close', () => stop());
    },
  };
}
