/**
 * `child_process` shim for the mobile host worker.
 *
 * Mobile apps cannot run arbitrary programs. The only child the main process needs on mobile is
 * the Reticulum sidecar (`mesh-client-reticulum`), which the native `MeshProcess` plugin runs:
 * on Android as a packaged executable from the app's native library directory, on iOS as an
 * in-process library thread speaking the same stdin/stdout/stderr + loopback HTTP contract.
 * Every other command fails with ENOENT, which main already handles (desktop tooling such as
 * `system_profiler`, `cargo`, or Windows sound players).
 */
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'readable-stream';

import { callNative, onNativeEvent } from '../../hostChannel';

const SIDECAR_BASENAME = /(^|\/)mesh-client-reticulum(\.exe)?$/;
const procs = new Map<string, ChildProcessShim>();
let nextId = 1;
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  onNativeEvent('MeshProcess', 'stdout', (d) => {
    const m = d as { id: string; dataB64: string };
    procs.get(m.id)?.stdout.push(Buffer.from(m.dataB64, 'base64'));
  });
  onNativeEvent('MeshProcess', 'stderr', (d) => {
    const m = d as { id: string; dataB64: string };
    procs.get(m.id)?.stderr.push(Buffer.from(m.dataB64, 'base64'));
  });
  onNativeEvent('MeshProcess', 'exit', (d) => {
    const m = d as { id: string; code: number | null; signal: string | null };
    procs.get(m.id)?._onExit(m.code, m.signal);
  });
}

export class ChildProcessShim extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;
  connected = false;
  readonly stdout = new Readable({ read() {} });
  readonly stderr = new Readable({ read() {} });
  readonly stdin: Writable;
  readonly stdio: unknown[];
  readonly spawnfile: string;
  readonly spawnargs: string[];
  private readonly id: string;

  constructor(
    command: string,
    args: string[],
    private readonly native: boolean,
  ) {
    super();
    this.id = `p${nextId++}`;
    this.spawnfile = command;
    this.spawnargs = [command, ...args];
    const id = this.id;
    this.stdin = new Writable({
      write(chunk: unknown, enc: BufferEncoding, cb: (e?: Error | null) => void) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, enc);
        if (!native) {
          cb(new Error('EPIPE'));
          return;
        }
        callNative('MeshProcess', 'writeStdin', { id, dataB64: buf.toString('base64') }).then(
          () => {
            cb();
          },
          (e: unknown) => {
            cb(e instanceof Error ? e : new Error(String(e)));
          },
        );
      },
      final(cb: (e?: Error | null) => void) {
        if (!native) {
          cb();
          return;
        }
        callNative('MeshProcess', 'closeStdin', { id }).then(
          () => {
            cb();
          },
          () => {
            cb();
          },
        );
      },
    });
    this.stdio = [this.stdin, this.stdout, this.stderr];
  }

  /** @internal */
  _start(args: string[], opts: { env?: Record<string, string | undefined>; cwd?: string }): void {
    if (!this.native) {
      queueMicrotask(() => {
        const err = Object.assign(new Error(`spawn ${this.spawnfile} ENOENT`), {
          code: 'ENOENT',
          errno: -2,
          syscall: `spawn ${this.spawnfile}`,
          path: this.spawnfile,
          spawnargs: args,
        });
        this.emit('error', err);
        this._onExit(-2, null);
      });
      return;
    }
    install();
    procs.set(this.id, this);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.env ?? {})) if (typeof v === 'string') env[k] = v;
    callNative<{ pid: number }>('MeshProcess', 'spawn', {
      id: this.id,
      program: 'reticulum-sidecar',
      args,
      env,
    }).then(
      (r) => {
        this.pid = r.pid;
        this.emit('spawn');
      },
      (e: unknown) => {
        procs.delete(this.id);
        const err = Object.assign(e instanceof Error ? e : new Error(String(e)), {
          code: 'ENOENT',
        });
        this.emit('error', err);
        this._onExit(-2, null);
      },
    );
  }

  /** @internal */
  _onExit(code: number | null, signal: string | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    procs.delete(this.id);
    this.exitCode = code;
    this.signalCode = signal;
    this.stdout.push(null);
    this.stderr.push(null);
    this.emit('exit', code, signal);
    queueMicrotask(() => this.emit('close', code, signal));
  }

  kill(signal: string | number = 'SIGTERM'): boolean {
    if (!this.native || this.exitCode !== null) return false;
    this.killed = true;
    void callNative('MeshProcess', 'kill', { id: this.id, signal: String(signal) }).catch(() => {});
    return true;
  }

  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  disconnect(): void {}
}

function isSidecar(command: string): boolean {
  return (
    SIDECAR_BASENAME.test(command) &&
    Boolean((globalThis as { __meshSidecarAvailable?: boolean }).__meshSidecarAvailable)
  );
}

export function spawn(
  command: string,
  argsOrOpts?: unknown,
  maybeOpts?: unknown,
): ChildProcessShim {
  const args = Array.isArray(argsOrOpts) ? (argsOrOpts as string[]) : [];
  const opts = ((Array.isArray(argsOrOpts) ? maybeOpts : argsOrOpts) ?? {}) as {
    env?: Record<string, string | undefined>;
    cwd?: string;
  };
  const cp = new ChildProcessShim(command, args, isSidecar(command));
  cp._start(args, opts);
  return cp;
}

function enoent(command: string): Error {
  return Object.assign(new Error(`spawn ${command} ENOENT`), {
    code: 'ENOENT',
    errno: -2,
    path: command,
  });
}

export function execFile(command: string, ...rest: unknown[]): ChildProcessShim {
  const cb = rest.find((r) => typeof r === 'function') as
    ((e: Error | null, so: string, se: string) => void) | undefined;
  const cp = new ChildProcessShim(command, [], false);
  queueMicrotask(() => {
    cb?.(enoent(command), '', '');
    cp._onExit(-2, null);
  });
  return cp;
}

export function exec(command: string, ...rest: unknown[]): ChildProcessShim {
  return execFile(command, ...rest);
}

export function spawnSync(command: string): {
  status: number | null;
  error: Error;
  stdout: Buffer;
  stderr: Buffer;
  pid: number;
  output: unknown[];
  signal: null;
} {
  return {
    status: null,
    error: enoent(command),
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    pid: 0,
    output: [],
    signal: null,
  };
}

export function execFileSync(command: string): never {
  throw enoent(command);
}

export function execSync(command: string): never {
  throw enoent(command);
}

export function fork(command: string): ChildProcessShim {
  return spawn(command);
}

export const ChildProcess = ChildProcessShim;
export default { spawn, spawnSync, exec, execFile, execFileSync, execSync, fork, ChildProcess };
