/**
 * `fs` shim for the mobile host worker.
 *
 * The desktop main process uses synchronous `fs` heavily (settings JSON, identity vault, Reticulum
 * config, attachments). A WebView worker has no synchronous durable filesystem, so files live in a
 * `memfs` volume and everything under `/data` is mirrored to durable storage (OPFS, or the native
 * app sandbox through `fsPersistence`).
 *
 * Integrity: writes land in memory immediately and are flushed in the background (debounced
 * `FLUSH_DEBOUNCE_MS`, plus on app pause and before quit). **Failure window:** a process kill
 * between a write and its flush loses that write; the previous durable copy stays intact because
 * each file is replaced whole. Flush failures are logged and the path stays dirty for retry.
 *
 * SQLite files (`*.db`, `*-journal`, …) are owned by the sqlite-wasm VFS; `exists` / `stat` /
 * `readFile` / `unlink` / `copyFile` / `rename` on those paths go to the VFS so backups, merges and
 * data reset keep working.
 *
 * Files written under `/exports/` (paths handed out by the mobile `dialog.showSaveDialog`) are
 * delivered to the OS share sheet once written, then removed from memory.
 */
import { Buffer } from 'buffer';
import { createFsFromVolume, Volume } from 'memfs';

import { EXPORTS_ROOT, isPersistedPath, isSqliteManagedPath, MOBILE_PATHS } from '../paths';
import { exportSqliteFile, importSqliteFile, sqliteFileExists, unlinkSqliteFile } from './sqlite';

export interface PersistBackend {
  readonly name: string;
  loadAll(): Promise<{ path: string; kind: 'file' | 'dir'; bytes?: Uint8Array }[]>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const vol = new Volume();
const mfs: any = createFsFromVolume(vol);

let backend: PersistBackend | null = null;
let exportSink: ((path: string, bytes: Uint8Array) => Promise<void>) | null = null;
const dirty = new Set<string>();
const pendingExports = new Set<string>();
const fdPaths = new Map<number, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let exportTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
const FLUSH_DEBOUNCE_MS = 400;
const EXPORT_DEBOUNCE_MS = 300;

function normalize(p: unknown): string | null {
  if (typeof p === 'string') return p;
  if (p instanceof URL) return decodeURIComponent(p.pathname);
  if (p instanceof Uint8Array) return Buffer.from(p).toString('utf8');
  return null;
}

function markDirty(p: unknown): void {
  const path = normalize(p);
  if (!path) return;
  if (path === EXPORTS_ROOT || path.startsWith(`${EXPORTS_ROOT}/`)) {
    pendingExports.add(path);
    scheduleExport();
    return;
  }
  if (!isPersistedPath(path)) return;
  dirty.add(path);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (!backend || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushFs();
  }, FLUSH_DEBOUNCE_MS);
}

function scheduleExport(): void {
  if (exportTimer) clearTimeout(exportTimer);
  exportTimer = setTimeout(() => {
    exportTimer = null;
    void deliverExports();
  }, EXPORT_DEBOUNCE_MS);
}

async function deliverExports(): Promise<void> {
  const paths = [...pendingExports];
  pendingExports.clear();
  for (const p of paths) {
    try {
      const st = mfs.statSync(p, { throwIfNoEntry: false });
      if (!st?.isFile()) continue;
      // Still open for writing → wait for close.
      if ([...fdPaths.values()].includes(p)) {
        pendingExports.add(p);
        scheduleExport();
        continue;
      }
      const bytes = new Uint8Array(mfs.readFileSync(p));
      await exportSink?.(p, bytes);
      mfs.rmSync(p, { force: true });
    } catch (e) {
      console.error(
        `mcL9003 [mobile/fs] export delivery failed for ${p}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/** Write every dirty persisted path to the durable backend. Safe to call concurrently. */
export async function flushFs(): Promise<void> {
  if (!backend) return;
  if (flushing) {
    await flushing;
    if (dirty.size === 0) return;
  }
  const b = backend;
  const paths = [...dirty].sort((a, z) => a.length - z.length);
  dirty.clear();
  flushing = (async () => {
    for (const p of paths) {
      try {
        const st = mfs.statSync(p, { throwIfNoEntry: false });
        if (!st) await b.remove(p);
        else if (st.isDirectory()) await b.mkdir(p);
        else if (st.isFile()) await b.writeFile(p, new Uint8Array(mfs.readFileSync(p)));
      } catch (e) {
        dirty.add(p);
        console.error(
          `mcL9004 [mobile/fs] persist failed for ${p} (${b.name}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  })().finally(() => {
    flushing = null;
  });
  await flushing;
  if (dirty.size > 0) scheduleFlush();
}

/** Mount the durable backend and load its contents into memory. Call once at boot. */
export async function mountPersistence(b: PersistBackend): Promise<void> {
  backend = b;
  const entries = await b.loadAll();
  entries.sort((a, z) => a.path.length - z.path.length);
  for (const e of entries) {
    try {
      if (e.kind === 'dir') mfs.mkdirSync(e.path, { recursive: true });
      else {
        mfs.mkdirSync(e.path.slice(0, e.path.lastIndexOf('/')) || '/', { recursive: true });
        mfs.writeFileSync(e.path, e.bytes ?? new Uint8Array(0));
      }
    } catch (err) {
      console.error(
        `mcL9005 [mobile/fs] could not restore ${e.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export function setExportSink(sink: (path: string, bytes: Uint8Array) => Promise<void>): void {
  exportSink = sink;
}

/** Place a user-picked file into the volume (dialog.showOpenDialog). */
export function writeImportedFile(path: string, bytes: Uint8Array): void {
  mfs.mkdirSync(path.slice(0, path.lastIndexOf('/')) || '/', { recursive: true });
  mfs.writeFileSync(path, bytes);
}

export function ensureBaseDirectories(): void {
  for (const p of [
    MOBILE_PATHS.userData,
    MOBILE_PATHS.logs,
    MOBILE_PATHS.documents,
    MOBILE_PATHS.downloads,
    MOBILE_PATHS.home,
    MOBILE_PATHS.temp,
    MOBILE_PATHS.userCache,
    MOBILE_PATHS.crashDumps,
    MOBILE_PATHS.app,
    EXPORTS_ROOT,
  ]) {
    mfs.mkdirSync(p, { recursive: true });
  }
}

// ─── SQLite overlay ────────────────────────────────────────────────────────────

function sqlitePath(p: unknown): string | null {
  const path = normalize(p);
  if (!path || !isSqliteManagedPath(path)) return null;
  if (mfs.existsSync(path)) return null;
  return path;
}

function enoent(syscall: string, path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${path}'`), {
    code: 'ENOENT',
    errno: -2,
    syscall,
    path,
  });
}

function sqliteStat(path: string): unknown {
  const size = exportSqliteFile(path).byteLength;
  const now = new Date();
  return {
    size,
    mode: 0o100600,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    mtime: now,
    ctime: now,
    atime: now,
    birthtime: now,
    mtimeMs: now.getTime(),
    ctimeMs: now.getTime(),
    atimeMs: now.getTime(),
    birthtimeMs: now.getTime(),
    dev: 1,
    ino: 1,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 4096,
    blocks: Math.ceil(size / 4096),
  };
}

const sqliteOverlaySync: Record<string, (...args: any[]) => any> = {
  existsSync: (p) => {
    const s = sqlitePath(p);
    return s ? sqliteFileExists(s) : undefined;
  },
  statSync: (p, opts) => {
    const s = sqlitePath(p);
    if (!s) return undefined;
    if (!sqliteFileExists(s)) {
      if (opts?.throwIfNoEntry === false) return null;
      throw enoent('stat', s);
    }
    return sqliteStat(s);
  },
  lstatSync: (p, opts) => sqliteOverlaySync.statSync(p, opts),
  accessSync: (p) => {
    const s = sqlitePath(p);
    if (!s) return undefined;
    if (!sqliteFileExists(s)) throw enoent('access', s);
    return null;
  },
  readFileSync: (p, opts) => {
    const s = sqlitePath(p);
    if (!s) return undefined;
    if (!sqliteFileExists(s)) throw enoent('open', s);
    const buf = Buffer.from(exportSqliteFile(s));
    const enc = typeof opts === 'string' ? opts : opts?.encoding;
    return enc ? buf.toString(enc) : buf;
  },
  unlinkSync: (p) => {
    const s = sqlitePath(p);
    if (!s) return undefined;
    if (!unlinkSqliteFile(s)) throw enoent('unlink', s);
    return null;
  },
  rmSync: (p, opts) => {
    const s = sqlitePath(p);
    if (!s) return undefined;
    if (!unlinkSqliteFile(s) && !opts?.force) throw enoent('rm', s);
    return null;
  },
  copyFileSync: (src, dst) => {
    const s = sqlitePath(src);
    const d = normalize(dst);
    if (!s || !d) return undefined;
    if (!sqliteFileExists(s)) throw enoent('copyfile', s);
    const bytes = exportSqliteFile(s);
    if (isSqliteManagedPath(d)) importSqliteFile(d, bytes);
    else {
      mfs.writeFileSync(d, bytes);
      markDirty(d);
    }
    return null;
  },
  renameSync: (src, dst) => {
    const s = sqlitePath(src);
    const d = normalize(dst);
    if (!s || !d) return undefined;
    sqliteOverlaySync.copyFileSync(s, d);
    unlinkSqliteFile(s);
    return null;
  },
  writeFileSync: (p, data) => {
    const path = normalize(p);
    if (!path || !isSqliteManagedPath(path)) return undefined;
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    // A non-database payload (empty placeholder, text) keeps memfs semantics.
    if (
      bytes.byteLength < 100 ||
      Buffer.from(bytes.subarray(0, 15)).toString() !== 'SQLite format 3'
    ) {
      return undefined;
    }
    importSqliteFile(path, bytes);
    return null;
  },
};

// ─── wrapping ──────────────────────────────────────────────────────────────────

/** Sync methods that mutate the named path argument(s). */
const MUTATING_PATH_ARGS: Record<string, number[]> = {
  writeFile: [0],
  appendFile: [0],
  mkdir: [0],
  rm: [0],
  rmdir: [0],
  unlink: [0],
  rename: [0, 1],
  copyFile: [1],
  cp: [1],
  truncate: [0],
  symlink: [1],
  link: [1],
  utimes: [0],
  chmod: [],
  chown: [],
};

function wrapSync(name: string, fn: (...a: any[]) => any): (...a: any[]) => any {
  const base = name.replace(/Sync$/, '');
  const overlay = sqliteOverlaySync[name];
  return (...args: any[]) => {
    if (overlay) {
      const r = overlay(...args);
      if (r !== undefined) return r === null ? undefined : r;
    }
    const result = fn(...args);
    if (base === 'mkdtemp') markDirty(result);
    else if (base === 'open') {
      const flags = String(args[1] ?? 'r');
      if (/[wa+]/.test(flags)) fdPaths.set(result as number, normalize(args[0]) ?? '');
    } else if (base === 'close') {
      const p = fdPaths.get(args[0] as number);
      fdPaths.delete(args[0] as number);
      if (p) markDirty(p);
    } else if (base === 'write' || base === 'writev' || base === 'ftruncate' || base === 'fsync') {
      const p = fdPaths.get(args[0] as number);
      if (p) markDirty(p);
    } else {
      for (const i of MUTATING_PATH_ARGS[base] ?? []) markDirty(args[i]);
      if (base === 'rename' || base === 'rm' || base === 'rmdir' || base === 'unlink') {
        markDirty(args[0]);
      }
    }
    return result;
  };
}

function wrapPromise(
  name: string,
  fn: (...a: any[]) => Promise<any>,
): (...a: any[]) => Promise<any> {
  const overlay = sqliteOverlaySync[`${name}Sync`];
  return async (...args: any[]) => {
    if (overlay) {
      const r = overlay(...args);
      if (r !== undefined) return r === null ? undefined : r;
    }
    const result = await fn(...args);
    if (name === 'mkdtemp') markDirty(result);
    else if (name === 'open') {
      const flags = String(args[1] ?? 'r');
      const handle = result as { fd: number; close: () => Promise<void> };
      if (/[wa+]/.test(flags)) {
        const p = normalize(args[0]) ?? '';
        const origClose = handle.close.bind(handle);
        handle.close = async () => {
          await origClose();
          markDirty(p);
        };
      }
    } else {
      for (const i of MUTATING_PATH_ARGS[name] ?? []) markDirty(args[i]);
      if (name === 'rename') markDirty(args[0]);
    }
    return result;
  };
}

function wrapCallback(name: string, fn: (...a: any[]) => any): (...a: any[]) => any {
  return (...args: any[]) => {
    const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    const overlay = sqliteOverlaySync[`${name}Sync`];
    if (overlay && cb) {
      try {
        const r = overlay(...args.slice(0, -1));
        if (r !== undefined) {
          queueMicrotask(() => cb(null, r === null ? undefined : r));
          return;
        }
      } catch (e) {
        queueMicrotask(() => cb(e));
        return;
      }
    }
    if (!cb) return fn(...args);
    const wrappedCb = (err: unknown, ...rest: unknown[]) => {
      if (!err) {
        if (name === 'mkdtemp') markDirty(rest[0]);
        else if (name === 'open') {
          const flags = String(args.length > 2 ? args[1] : 'r');
          if (/[wa+]/.test(flags)) fdPaths.set(rest[0] as number, normalize(args[0]) ?? '');
        } else if (name === 'close') {
          const p = fdPaths.get(args[0] as number);
          fdPaths.delete(args[0] as number);
          if (p) markDirty(p);
        } else if (name === 'write' || name === 'writev') {
          const p = fdPaths.get(args[0] as number);
          if (p) markDirty(p);
        } else {
          for (const i of MUTATING_PATH_ARGS[name] ?? []) markDirty(args[i]);
          if (name === 'rename') markDirty(args[0]);
        }
      }
      cb(err, ...rest);
    };
    return fn(...args.slice(0, -1), wrappedCb);
  };
}

const fsShim: any = {};
for (const key of Object.keys(mfs)) {
  const v = mfs[key];
  if (typeof v !== 'function' || /^[A-Z]/.test(key)) {
    fsShim[key] = v;
    continue;
  }
  if (key.endsWith('Sync')) fsShim[key] = wrapSync(key, v.bind(mfs));
  else if (key === 'createWriteStream') {
    fsShim[key] = (p: unknown, opts?: unknown) => {
      const stream = mfs.createWriteStream(p, opts);
      const done = () => {
        markDirty(p);
      };
      stream.on('finish', done);
      stream.on('close', done);
      return stream;
    };
  } else if (key === 'exists') {
    fsShim[key] = (p: unknown, cb: (exists: boolean) => void) => {
      queueMicrotask(() => {
        cb(fsShim.existsSync(p));
      });
    };
  } else if (
    key === 'createReadStream' ||
    key === 'watch' ||
    key === 'watchFile' ||
    key === 'unwatchFile'
  ) {
    fsShim[key] = v.bind(mfs);
  } else fsShim[key] = wrapCallback(key, v.bind(mfs));
}
fsShim.realpathSync.native = fsShim.realpathSync;
fsShim.realpath.native = fsShim.realpath;

const promisesShim: any = {};
for (const key of Object.keys(mfs.promises)) {
  const v = mfs.promises[key];
  promisesShim[key] =
    typeof v === 'function' && !/^[A-Z]/.test(key) ? wrapPromise(key, v.bind(mfs.promises)) : v;
}
promisesShim.constants = mfs.constants;
fsShim.promises = promisesShim;
fsShim.constants = mfs.constants;

/** Test/debug hook. */
export function __getVolume(): unknown {
  return vol;
}

export const promises = promisesShim;
export const constants = mfs.constants;
export const accessSync = fsShim.accessSync;
export const appendFileSync = fsShim.appendFileSync;
export const chmodSync = fsShim.chmodSync;
export const chownSync = fsShim.chownSync;
export const closeSync = fsShim.closeSync;
export const copyFileSync = fsShim.copyFileSync;
export const cpSync = fsShim.cpSync;
export const existsSync = fsShim.existsSync;
export const fchmodSync = fsShim.fchmodSync;
export const fchownSync = fsShim.fchownSync;
export const fdatasyncSync = fsShim.fdatasyncSync;
export const fstatSync = fsShim.fstatSync;
export const fsyncSync = fsShim.fsyncSync;
export const ftruncateSync = fsShim.ftruncateSync;
export const futimesSync = fsShim.futimesSync;
export const globSync = fsShim.globSync;
export const lchmodSync = fsShim.lchmodSync;
export const lchownSync = fsShim.lchownSync;
export const linkSync = fsShim.linkSync;
export const lstatSync = fsShim.lstatSync;
export const mkdirSync = fsShim.mkdirSync;
export const mkdtempSync = fsShim.mkdtempSync;
export const openSync = fsShim.openSync;
export const opendirSync = fsShim.opendirSync;
export const readdirSync = fsShim.readdirSync;
export const readFileSync = fsShim.readFileSync;
export const readlinkSync = fsShim.readlinkSync;
export const readSync = fsShim.readSync;
export const readvSync = fsShim.readvSync;
export const realpathSync = fsShim.realpathSync;
export const renameSync = fsShim.renameSync;
export const rmdirSync = fsShim.rmdirSync;
export const rmSync = fsShim.rmSync;
export const statfsSync = fsShim.statfsSync;
export const statSync = fsShim.statSync;
export const symlinkSync = fsShim.symlinkSync;
export const truncateSync = fsShim.truncateSync;
export const unlinkSync = fsShim.unlinkSync;
export const utimesSync = fsShim.utimesSync;
export const lutimesSync = fsShim.lutimesSync;
export const writeFileSync = fsShim.writeFileSync;
export const writeSync = fsShim.writeSync;
export const writevSync = fsShim.writevSync;
export const access = fsShim.access;
export const appendFile = fsShim.appendFile;
export const chmod = fsShim.chmod;
export const chown = fsShim.chown;
export const close = fsShim.close;
export const copyFile = fsShim.copyFile;
export const cp = fsShim.cp;
export const createReadStream = fsShim.createReadStream;
export const createWriteStream = fsShim.createWriteStream;
export const exists = fsShim.exists;
export const fchmod = fsShim.fchmod;
export const fchown = fsShim.fchown;
export const fdatasync = fsShim.fdatasync;
export const fstat = fsShim.fstat;
export const fsync = fsShim.fsync;
export const ftruncate = fsShim.ftruncate;
export const futimes = fsShim.futimes;
export const glob = fsShim.glob;
export const lchmod = fsShim.lchmod;
export const lchown = fsShim.lchown;
export const link = fsShim.link;
export const lstat = fsShim.lstat;
export const mkdir = fsShim.mkdir;
export const mkdtemp = fsShim.mkdtemp;
export const open = fsShim.open;
export const openAsBlob = fsShim.openAsBlob;
export const opendir = fsShim.opendir;
export const read = fsShim.read;
export const readv = fsShim.readv;
export const readdir = fsShim.readdir;
export const readFile = fsShim.readFile;
export const readlink = fsShim.readlink;
export const realpath = fsShim.realpath;
export const rename = fsShim.rename;
export const rm = fsShim.rm;
export const rmdir = fsShim.rmdir;
export const stat = fsShim.stat;
export const statfs = fsShim.statfs;
export const symlink = fsShim.symlink;
export const truncate = fsShim.truncate;
export const unlink = fsShim.unlink;
export const unwatchFile = fsShim.unwatchFile;
export const utimes = fsShim.utimes;
export const lutimes = fsShim.lutimes;
export const watch = fsShim.watch;
export const watchFile = fsShim.watchFile;
export const write = fsShim.write;
export const writev = fsShim.writev;
export const writeFile = fsShim.writeFile;
export const _toUnixTimestamp = fsShim._toUnixTimestamp;
export const Stats = mfs.Stats;
export const Dirent = mfs.Dirent;
export const Dir = mfs.Dir;
export const F_OK = 0;
export const R_OK = 4;
export const W_OK = 2;
export const X_OK = 1;
export default fsShim;
