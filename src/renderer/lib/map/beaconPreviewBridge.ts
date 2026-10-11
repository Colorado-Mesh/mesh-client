import type {
  BeaconConnectResult,
  BeaconFeedApi,
  BeaconFeedUpdate,
  RegionalFeedProvider,
} from '@/shared/beacon';
import { MS_PER_SECOND } from '@/shared/timeConstants';

interface PendingRequest {
  message: string;
  resolve: (result: BeaconConnectResult) => void;
  timeout: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFeedUpdate(value: unknown): value is BeaconFeedUpdate {
  if (!isRecord(value)) return false;
  if (value.provider !== undefined && value.provider !== 'beacon' && value.provider !== 'corescope')
    return false;
  if (value.type === 'packet') return isRecord(value.packet);
  if (value.type === 'message') return isRecord(value.message);
  if (value.type === 'snapshot') {
    return (
      Array.isArray(value.nodes) && Array.isArray(value.observers) && Array.isArray(value.regions)
    );
  }
  return (
    value.type === 'status' &&
    typeof value.status === 'string' &&
    ['connecting', 'live', 'reconnecting', 'disconnected', 'error'].includes(value.status)
  );
}

/** Standalone Vite preview only. The packaged app continues to use its native IPC namespace. */
export function installBeaconPreviewBridge(): () => void {
  if (
    !import.meta.env.DEV ||
    !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) ||
    navigator.userAgent.includes('Electron/')
  )
    return () => {};

  const originalApi = window.electronAPI;
  const originalBeacon = originalApi.beacon;
  const subscribers = new Set<(update: BeaconFeedUpdate) => void>();
  const pending = new Map<number, PendingRequest>();
  let socket: WebSocket | null = null;
  let nextId = 0;
  let disposed = false;
  let disconnecting: Promise<void> | null = null;
  let connectionIntent = 0;
  let activeProvider: RegionalFeedProvider = 'beacon';

  function publish(update: BeaconFeedUpdate) {
    for (const subscriber of subscribers) subscriber(update);
  }

  function settle(id: number, result: BeaconConnectResult) {
    const request = pending.get(id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(id);
    request.resolve(result);
  }

  function failPending() {
    for (const id of pending.keys())
      settle(id, { ok: false, error: 'Preview bridge disconnected' });
  }

  function getSocket() {
    if (socket && socket.readyState < WebSocket.CLOSING) return socket;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const next = new WebSocket(`${protocol}//${window.location.host}/__mesh-client-beacon-preview`);
    socket = next;
    next.addEventListener('open', () => {
      if (socket !== next || disposed) {
        next.close();
        return;
      }
      for (const request of pending.values()) next.send(request.message);
    });
    next.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (socket !== next || typeof event.data !== 'string') return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        // catch-no-log-ok malformed local preview data is ignored
        return;
      }
      if (!isRecord(message)) return;
      if (message.type === 'update' && isFeedUpdate(message.update)) publish(message.update);
      if (
        message.type === 'response' &&
        typeof message.id === 'number' &&
        typeof message.ok === 'boolean'
      ) {
        settle(message.id, {
          ok: message.ok,
          ...(typeof message.error === 'string' ? { error: message.error } : {}),
        });
      }
    });
    next.addEventListener('close', () => {
      if (socket !== next) return;
      socket = null;
      failPending();
      if (!disposed) publish({ type: 'status', status: 'disconnected', provider: activeProvider });
    });
    next.addEventListener('error', () => {
      if (socket !== next) return;
      failPending();
      if (!disposed)
        publish({
          type: 'status',
          status: 'error',
          message: 'Preview bridge unavailable',
          provider: activeProvider,
        });
    });
    return next;
  }

  function request(
    type: 'connect' | 'disconnect',
    payload?: unknown,
  ): Promise<BeaconConnectResult> {
    if (disposed || pending.size >= 4) {
      return Promise.resolve({ ok: false, error: 'Preview bridge unavailable or busy' });
    }
    return new Promise((resolve) => {
      const id = ++nextId;
      const message = JSON.stringify({ id, type, ...(payload ? { request: payload } : {}) });
      const timeout = setTimeout(() => {
        settle(id, { ok: false, error: 'Preview bridge timed out' });
        socket?.close();
      }, 30 * MS_PER_SECOND);
      pending.set(id, { message, resolve, timeout });
      const connection = getSocket();
      if (connection.readyState === WebSocket.OPEN) connection.send(message);
    });
  }

  const api: BeaconFeedApi = {
    connect: (options) => {
      const intent = ++connectionIntent;
      const connectNow = () => {
        activeProvider = options.provider ?? 'beacon';
        return request('connect', options);
      };
      if (!disconnecting) return connectNow();
      return disconnecting.then(() =>
        intent === connectionIntent
          ? connectNow()
          : { ok: false, error: 'Preview connection canceled' },
      );
    },
    disconnect: () => {
      connectionIntent += 1;
      if (disconnecting) return disconnecting;
      const connection = socket;
      const provider = activeProvider;
      if (!connection) return Promise.resolve();
      disconnecting = (async () => {
        try {
          await request('disconnect');
        } finally {
          // Clear this connection's pending requests before a waiting connect can open its successor.
          if (socket === connection) {
            socket = null;
            failPending();
          }
          connection.close();
          disconnecting = null;
          if (!disposed) publish({ type: 'status', status: 'disconnected', provider });
        }
      })();
      return disconnecting;
    },
    onUpdate(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
  };
  // Keep the stub's non-enumerable marker and identity, which select browser-safe map tiles.
  originalApi.beacon = api;
  return () => {
    if (disposed) return;
    disposed = true;
    failPending();
    socket?.close();
    socket = null;
    subscribers.clear();
    if (Object.is(originalApi.beacon, api)) originalApi.beacon = originalBeacon;
  };
}
