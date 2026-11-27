/**
 * Node globals for the mobile host worker (`process`, `Buffer`, `global`, `setImmediate`).
 * Imported first by the worker entry so every shim and main-process module sees them.
 */
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';

const start = performance.now();

function hrtime(prev?: [number, number]): [number, number] {
  const t = performance.now();
  const sec = Math.floor(t / 1000);
  const ns = Math.floor((t % 1000) * 1e6);
  if (!prev) return [sec, ns];
  let ds = sec - prev[0];
  let dn = ns - prev[1];
  if (dn < 0) {
    ds -= 1;
    dn += 1e9;
  }
  return [ds, dn];
}
hrtime.bigint = (): bigint => BigInt(Math.floor(performance.now() * 1e6));

function memoryUsage(): Record<string, number> {
  const m = (performance as any).memory as
    { usedJSHeapSize?: number; totalJSHeapSize?: number } | undefined;
  return {
    rss: m?.totalJSHeapSize ?? 0,
    heapTotal: m?.totalJSHeapSize ?? 0,
    heapUsed: m?.usedJSHeapSize ?? 0,
    external: 0,
    arrayBuffers: 0,
  };
}
memoryUsage.rss = (): number => memoryUsage().rss;

const stdio = (level: 'debug' | 'error') => ({
  isTTY: false,
  columns: 80,
  fd: level === 'debug' ? 1 : 2,
  write(chunk: unknown): boolean {
    const s = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array);
    if (level === 'debug') console.debug(s.replace(/\n$/, ''));
    else console.error(s.replace(/\n$/, ''));
    return true;
  },
  on(): void {},
  once(): void {},
  end(): void {},
});

const proc: any = new EventEmitter();
Object.assign(proc, {
  platform: 'linux',
  arch: 'arm64',
  env: { NODE_ENV: 'production' },
  argv: ['/app/mesh-client'],
  argv0: 'mesh-client',
  execArgv: [],
  execPath: '/app/mesh-client',
  pid: 2,
  ppid: 1,
  title: 'mesh-client',
  version: 'v24.0.0',
  versions: { node: '24.0.0', electron: '45.0.0', chrome: '140.0.0.0', v8: '14.0', modules: '140' },
  release: { name: 'node' },
  features: {},
  config: { variables: {} },
  type: 'browser',
  resourcesPath: '/app/resources',
  defaultApp: false,
  mas: false,
  windowsStore: false,
  sandboxed: false,
  contextIsolated: false,
  noDeprecation: true,
  throwDeprecation: false,
  traceDeprecation: false,
  exitCode: undefined,
  stdout: stdio('debug'),
  stderr: stdio('error'),
  stdin: null,
  cwd: () => '/app',
  chdir: () => {},
  uptime: () => (performance.now() - start) / 1000,
  hrtime,
  memoryUsage,
  cpuUsage: () => ({ user: 0, system: 0 }),
  resourceUsage: () => ({}),
  nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => {
    queueMicrotask(() => {
      fn(...args);
    });
  },
  exit: (code?: number) => {
    proc.emit('exit', code ?? 0);
    (globalThis as any).__meshHostExit?.(code ?? 0);
  },
  kill: () => true,
  abort: () => {},
  crash: () => {},
  hang: () => {},
  emitWarning: () => {},
  umask: () => 0o022,
  getuid: () => 0,
  getgid: () => 0,
  geteuid: () => 0,
  getegid: () => 0,
  getSystemVersion: () => String(proc.platform),
  getCreationTime: () => Date.now() - (performance.now() - start),
  getProcessMemoryInfo: () => Promise.resolve({ private: 0, shared: 0, residentSet: 0 }),
  getSystemMemoryInfo: () => ({ total: 0, free: 0 }),
  getHeapStatistics: () => ({}),
  getBlinkMemoryInfo: () => ({}),
  binding: () => ({}),
  setUncaughtExceptionCaptureCallback: () => {},
  hasUncaughtExceptionCaptureCallback: () => false,
  report: { getReport: () => ({}) },
});

/**
 * Node-style timer handles: `setTimeout` / `setInterval` return objects with `ref` / `unref` /
 * `hasRef` / `refresh` (main calls `.unref()` on housekeeping timers). The handle converts to its
 * numeric id, so the browser `clearTimeout` / `clearInterval` accept it unchanged.
 */
class TimerHandle {
  constructor(
    private id: number,
    private readonly rearm: (() => number) | null,
  ) {}
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  hasRef(): boolean {
    return true;
  }
  refresh(): this {
    if (this.rearm) {
      nativeClearTimeout(this.id);
      this.id = this.rearm();
    }
    return this;
  }
  close(): this {
    nativeClearTimeout(this.id);
    return this;
  }
  [Symbol.toPrimitive](): number {
    return this.id;
  }
}

const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeSetInterval = globalThis.setInterval.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
const nativeClearInterval = globalThis.clearInterval.bind(globalThis);

function toId(h: unknown): number | undefined {
  if (h == null) return undefined;
  return typeof h === 'number' ? h : Number(h);
}

const g = globalThis as any;
g.setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  const arm = () => nativeSetTimeout(fn, ms, ...args) as unknown as number;
  return new TimerHandle(arm(), arm);
};
g.setInterval = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
  new TimerHandle(nativeSetInterval(fn, ms, ...args) as unknown as number, null);
g.clearTimeout = (h: unknown) => {
  nativeClearTimeout(toId(h));
};
g.clearInterval = (h: unknown) => {
  nativeClearInterval(toId(h));
};
g.process = proc;
g.Buffer = Buffer;
g.global = globalThis;
g.setImmediate = (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
  g.setTimeout(fn, 0, ...args);
g.clearImmediate = (h: unknown) => {
  nativeClearTimeout(toId(h));
};

// Route worker-level failures to Node-style process events (main registers handlers for these).
self.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
  if (proc.listenerCount('unhandledRejection') > 0) {
    ev.preventDefault();
    proc.emit('unhandledRejection', ev.reason, ev.promise);
  }
});
self.addEventListener('error', (ev: ErrorEvent) => {
  if (proc.listenerCount('uncaughtException') > 0) {
    ev.preventDefault();
    proc.emit('uncaughtException', ev.error ?? new Error(ev.message));
  }
});

export const nodeProcess = proc;
