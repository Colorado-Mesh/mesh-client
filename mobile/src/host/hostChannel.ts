/**
 * Worker side of the mobile host channel (see `protocol.ts`).
 *
 * Owns the `ipcMain` handler registry, `webContents.send` fan-out to the UI thread, Capacitor
 * plugin calls (which must run on the UI thread), and UI requests (dialogs, share, notifications).
 */
import {
  deserializeError,
  type HostBootConfig,
  type HostToUiMessage,
  serializeError,
  type UiToHostMessage,
} from './protocol';

export type InvokeHandler = (event: unknown, ...args: unknown[]) => unknown;
export type SendListener = (event: unknown, ...args: unknown[]) => void;
export type NativeEventListener = (data: unknown) => void;
export type LifecycleListener = (state: 'pause' | 'resume' | 'beforeQuit') => void;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const invokeHandlers = new Map<string, InvokeHandler>();
const sendListeners = new Map<string, Set<SendListener>>();
const nativeListeners = new Map<string, Set<NativeEventListener>>();
const lifecycleListeners = new Set<LifecycleListener>();
const pendingNative = new Map<number, Pending>();
const pendingUi = new Map<number, Pending>();
/** Invokes that arrive before main finished registering handlers wait here (by channel). */
const waitingForHandler = new Map<string, (() => void)[]>();
let nextId = 1;
let bootConfig: HostBootConfig | null = null;
let post: (msg: HostToUiMessage, transfer?: Transferable[]) => void = () => {};

/** The IPC event object every handler receives; satisfies `validateIpcSender`. */
let ipcEvent: Record<string, unknown> | null = null;

export function setIpcEventFactory(factory: () => Record<string, unknown>): void {
  ipcEvent = factory();
}

export function getBootConfig(): HostBootConfig {
  if (!bootConfig) throw new Error('mobile host: boot config not received yet');
  return bootConfig;
}

export function setBootConfig(config: HostBootConfig): void {
  bootConfig = config;
}

export function bindPort(poster: (msg: HostToUiMessage, transfer?: Transferable[]) => void): void {
  post = poster;
}

export function postToUi(msg: HostToUiMessage): void {
  post(msg);
}

// ─── ipcMain registry ──────────────────────────────────────────────────────────

export function registerInvokeHandler(channel: string, handler: InvokeHandler): void {
  if (invokeHandlers.has(channel)) {
    throw new Error(`Attempted to register a second handler for '${channel}'`);
  }
  invokeHandlers.set(channel, handler);
  const waiters = waitingForHandler.get(channel);
  if (waiters) {
    waitingForHandler.delete(channel);
    for (const w of waiters) w();
  }
}

export function removeInvokeHandler(channel: string): void {
  invokeHandlers.delete(channel);
}

export function hasInvokeHandler(channel: string): boolean {
  return invokeHandlers.has(channel);
}

export function addSendListener(channel: string, listener: SendListener): void {
  let set = sendListeners.get(channel);
  if (!set) {
    set = new Set();
    sendListeners.set(channel, set);
  }
  set.add(listener);
}

export function removeSendListener(channel: string, listener: SendListener): void {
  sendListeners.get(channel)?.delete(listener);
}

export function removeAllSendListeners(channel?: string): void {
  if (channel) sendListeners.delete(channel);
  else sendListeners.clear();
}

export function emitToUi(channel: string, args: unknown[]): void {
  post({ t: 'event', channel, args: toCloneable(args) as unknown[] });
}

/** How long an early invoke waits for main to register its handler (lazy sibling modules). */
const HANDLER_WAIT_MS = 15_000;

function waitForHandler(channel: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const list = waitingForHandler.get(channel);
      if (list) {
        const idx = list.indexOf(done);
        if (idx >= 0) list.splice(idx, 1);
      }
      reject(new Error(`No handler registered for '${channel}'`));
    }, HANDLER_WAIT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const list = waitingForHandler.get(channel) ?? [];
    list.push(done);
    waitingForHandler.set(channel, list);
  });
}

async function runInvoke(id: number, channel: string, args: unknown[]): Promise<void> {
  try {
    if (!invokeHandlers.has(channel)) await waitForHandler(channel);
    const handler = invokeHandlers.get(channel);
    if (!handler) throw new Error(`No handler registered for '${channel}'`);
    const value = await handler(ipcEvent ?? {}, ...args);
    post({ t: 'result', id, ok: true, value: toCloneable(value) });
  } catch (err) {
    // Electron prefixes rejected invoke errors the same way; renderer error humanizers match it.
    const e = serializeError(err);
    e.message = `Error invoking remote method '${channel}': ${e.name === 'Error' ? 'Error' : e.name}: ${e.message}`;
    post({ t: 'result', id, ok: false, error: e });
  }
}

function runSend(channel: string, args: unknown[]): void {
  const set = sendListeners.get(channel);
  if (!set) return;
  for (const l of [...set]) {
    try {
      l(ipcEvent ?? {}, ...args);
    } catch (err) {
      console.error(
        `mcM0019 [mobile/host] ipcMain.on('${channel}') listener threw: ${serializeError(err).message}`,
      );
    }
  }
}

// ─── Native (Capacitor) calls ──────────────────────────────────────────────────

export function callNative<T = unknown>(
  plugin: string,
  method: string,
  args: unknown = {},
): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pendingNative.set(id, { resolve: resolve as (v: unknown) => void, reject });
    post({ t: 'native', id, plugin, method, args: [args] });
  });
}

/** Subscribe to a plugin event; the UI thread attaches the Capacitor listener on first use. */
export function onNativeEvent(
  plugin: string,
  event: string,
  listener: NativeEventListener,
): () => void {
  const key = `${plugin}:${event}`;
  let set = nativeListeners.get(key);
  if (!set) {
    set = new Set();
    nativeListeners.set(key, set);
    post({ t: 'native', id: 0, plugin, method: '__addListener', args: [{ event }] });
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

// ─── UI requests ───────────────────────────────────────────────────────────────

export function requestUi<T = unknown>(op: string, ...args: unknown[]): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pendingUi.set(id, { resolve: resolve as (v: unknown) => void, reject });
    post({ t: 'ui', id, op, args: toCloneable(args) as unknown[] });
  });
}

export function onLifecycle(listener: LifecycleListener): () => void {
  lifecycleListeners.add(listener);
  return () => lifecycleListeners.delete(listener);
}

// ─── Inbound dispatch ──────────────────────────────────────────────────────────

export function handleUiMessage(msg: UiToHostMessage): void {
  switch (msg.t) {
    case 'invoke':
      void runInvoke(msg.id, msg.channel, msg.args);
      return;
    case 'send':
      runSend(msg.channel, msg.args);
      return;
    case 'nativeResult': {
      const p = pendingNative.get(msg.id);
      if (!p) return;
      pendingNative.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(deserializeError(msg.error));
      return;
    }
    case 'uiResult': {
      const p = pendingUi.get(msg.id);
      if (!p) return;
      pendingUi.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(deserializeError(msg.error));
      return;
    }
    case 'nativeEvent': {
      const set = nativeListeners.get(`${msg.plugin}:${msg.event}`);
      if (!set) return;
      for (const l of [...set]) {
        try {
          l(msg.data);
        } catch (err) {
          console.error(
            `mcM0020 [mobile/host] native listener ${msg.plugin}:${msg.event} threw: ${serializeError(err).message}`,
          );
        }
      }
      return;
    }
    case 'lifecycle':
      for (const l of [...lifecycleListeners]) {
        try {
          l(msg.state);
        } catch (err) {
          console.error(
            `mcM0021 [mobile/host] lifecycle listener threw: ${serializeError(err).message}`,
          );
        }
      }
      return;
    case 'boot':
      // Handled by the worker entry before main loads.
      return;
  }
}

/**
 * Electron's IPC uses the structured clone algorithm and turns Node `Buffer` into `Uint8Array`.
 * postMessage already does the same; this strips values postMessage would throw on
 * (functions, class instances with private slots) the way Electron drops them.
 */
function toCloneable(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  const t = typeof value;
  if (t === 'function' || t === 'symbol') return undefined;
  if (t !== 'object') return value;
  if (depth > 64) return undefined;
  if (ArrayBuffer.isView(value)) {
    // Copy Node Buffers (pooled slabs) to a plain Uint8Array of exact length.
    if (value instanceof Uint8Array && value.constructor !== Uint8Array) {
      return new Uint8Array(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
      );
    }
    return value;
  }
  if (value instanceof ArrayBuffer || value instanceof Date || value instanceof RegExp) {
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Map) {
    const m = new Map();
    for (const [k, v] of value) m.set(toCloneable(k, depth + 1), toCloneable(v, depth + 1));
    return m;
  }
  if (value instanceof Set) {
    const s = new Set();
    for (const v of value) s.add(toCloneable(v, depth + 1));
    return s;
  }
  if (Array.isArray(value)) return value.map((v) => toCloneable(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const c = toCloneable(v, depth + 1);
    if (c !== undefined || v === undefined) out[k] = c;
  }
  return out;
}
