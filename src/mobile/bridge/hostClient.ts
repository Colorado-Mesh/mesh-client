/**
 * UI-thread client for the mobile host worker (see `src/mobile/host/protocol.ts`).
 * Starts the worker, forwards `ipcRenderer` traffic, runs Capacitor plugin calls the worker
 * requests, and performs UI operations (dialogs, share sheet, notifications) main asks for.
 */
import {
  deserializeError,
  type HostBootConfig,
  type HostToUiMessage,
  serializeError,
  type UiToHostMessage,
} from '../host/protocol';
import { callPlugin, listenPlugin } from './nativePlugins';
import { runUiOp } from './uiOps';

export type Listener = (event: unknown, ...args: unknown[]) => void;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const listeners = new Map<string, Set<Listener>>();
const attachedNativeEvents = new Set<string>();
let readyResolve: () => void = () => {};
let readyReject: (e: Error) => void = () => {};
const ready = new Promise<void>((res, rej) => {
  readyResolve = res;
  readyReject = rej;
});
/** Renderer-side IPC event object (`event.sender` is never used by the preload). */
const RENDERER_EVENT = Object.freeze({ sender: null, senderId: 0, ports: [] });

function post(msg: UiToHostMessage): void {
  if (!worker) throw new Error('mobile host not started');
  worker.postMessage(msg);
}

export function hostInvoke(channel: string, args: unknown[]): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      post({ t: 'invoke', id, channel, args: cloneArgs(args) });
    } catch (e) {
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export function hostSend(channel: string, args: unknown[]): void {
  try {
    post({ t: 'send', channel, args: cloneArgs(args) });
  } catch (e) {
    console.warn(
      `[mobile] ipc send ${channel} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function hostOn(channel: string, listener: Listener): void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(listener);
}

export function hostOff(channel: string | null, listener: Listener | null): void {
  if (channel === null) {
    listeners.clear();
    return;
  }
  if (!listener) listeners.delete(channel);
  else listeners.get(channel)?.delete(listener);
}

export function sendLifecycle(state: 'pause' | 'resume' | 'beforeQuit'): void {
  if (worker) post({ t: 'lifecycle', state });
}

/** Structured clone drops functions; strip them so postMessage never throws on renderer args. */
function cloneArgs(args: unknown[]): unknown[] {
  try {
    structuredClone(args);
    return args;
  } catch {
    return JSON.parse(
      JSON.stringify(args, (_k, v: unknown) => (typeof v === 'function' ? undefined : v)),
    ) as unknown[];
  }
}

async function handleNative(msg: Extract<HostToUiMessage, { t: 'native' }>): Promise<void> {
  const [arg] = msg.args;
  if (msg.method === '__addListener') {
    const event = (arg as { event: string }).event;
    const key = `${msg.plugin}:${event}`;
    if (attachedNativeEvents.has(key)) return;
    attachedNativeEvents.add(key);
    try {
      await listenPlugin(msg.plugin, event, (data) => {
        worker?.postMessage({
          t: 'nativeEvent',
          plugin: msg.plugin,
          event,
          data,
        } satisfies UiToHostMessage);
      });
    } catch (e) {
      attachedNativeEvents.delete(key);
      console.warn(
        `[mobile] addListener ${key} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return;
  }
  try {
    const value = await callPlugin(msg.plugin, msg.method, arg);
    post({ t: 'nativeResult', id: msg.id, ok: true, value });
  } catch (e) {
    post({ t: 'nativeResult', id: msg.id, ok: false, error: serializeError(e) });
  }
}

async function handleUi(msg: Extract<HostToUiMessage, { t: 'ui' }>): Promise<void> {
  try {
    const value = await runUiOp(msg.op, msg.args, { importFile: importIntoHost });
    post({ t: 'uiResult', id: msg.id, ok: true, value });
  } catch (e) {
    post({ t: 'uiResult', id: msg.id, ok: false, error: serializeError(e) });
  }
}

/** Write user-picked file bytes into the host filesystem; returns the host path. */
function importIntoHost(name: string, bytes: Uint8Array): Promise<string> {
  return hostInvoke('__mobile:importFile', [name, bytes]) as Promise<string>;
}

function onMessage(ev: MessageEvent<HostToUiMessage>): void {
  const msg = ev.data;
  switch (msg.t) {
    case 'result': {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(deserializeError(msg.error));
      return;
    }
    case 'event': {
      const set = listeners.get(msg.channel);
      if (!set) return;
      for (const l of [...set]) {
        try {
          l(RENDERER_EVENT, ...msg.args);
        } catch (e) {
          console.error(`[mobile] listener for ${msg.channel} threw`, e);
        }
      }
      return;
    }
    case 'native':
      void handleNative(msg);
      return;
    case 'ui':
      void handleUi(msg);
      return;
    case 'log':
      if (msg.level === 'error') console.error(msg.text);
      else if (msg.level === 'warn') console.warn(msg.text);
      else console.debug(msg.text);
      return;
    case 'ready':
      readyResolve();
      return;
    case 'bootFailed':
      readyReject(deserializeError(msg.error));
      return;
  }
}

export interface StartHostOptions {
  workerUrl: string;
  wasmUrl: string;
  config: HostBootConfig;
  sidecarAvailable: boolean;
}

/** Start the host worker and resolve once main has created its window. */
export function startHost(opts: StartHostOptions): Promise<void> {
  if (worker) return ready;
  worker = new Worker(opts.workerUrl, { type: 'module', name: 'mesh-host' });
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', (ev) => {
    console.error('[mobile] host worker error', ev.message);
    readyReject(new Error(ev.message || 'host worker failed to load'));
  });
  post({
    t: 'boot',
    config: {
      ...opts.config,
      wasmUrl: opts.wasmUrl,
      sidecarAvailable: opts.sidecarAvailable,
    } as HostBootConfig,
  });
  return ready;
}
