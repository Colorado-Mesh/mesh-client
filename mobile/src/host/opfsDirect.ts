/**
 * Direct (async, not memory-mirrored) OPFS storage for large file trees the main process only
 * touches through `fs/promises` — the offline map tile cache (up to 1 GiB). Keeping those in the
 * in-memory volume would load every tile at boot; here each call goes straight to OPFS.
 *
 * Covers the `fs.promises` calls the tile cache uses: mkdir, readdir, readFile, writeFile,
 * rename, rm, unlink, stat, utimes, access. `utimes` keeps an in-memory access-time override
 * (OPFS cannot set lastModified); it only feeds the cache's LRU ordering and resets on restart.
 * Errors carry Node codes (`ENOENT`, `EEXIST`, `ENOTDIR`).
 */
import { Buffer } from 'buffer';

/** Virtual prefixes served directly from OPFS (relative to the OPFS root dir below). */
const OPFS_DIRECT_PREFIXES = ['/data/user/tile-cache'];
const OPFS_DIRECT_ROOT = 'mesh-direct';

type Dir = FileSystemDirectoryHandle;
type FileHandle = FileSystemFileHandle;

let rootPromise: Promise<Dir> | null = null;
let enabled = false;
const mtimeOverrides = new Map<string, number>();

export function enableOpfsDirect(): void {
  enabled = true;
}

export function isOpfsDirectPath(p: string): boolean {
  return enabled && OPFS_DIRECT_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`));
}

function root(): Promise<Dir> {
  rootPromise ??= navigator.storage
    .getDirectory()
    .then((r) => r.getDirectoryHandle(OPFS_DIRECT_ROOT, { create: true }));
  return rootPromise;
}

function err(code: string, syscall: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${syscall} '${path}'`), { code, syscall, path });
}

function segs(p: string): string[] {
  return p.split('/').filter(Boolean);
}

function isNotFound(e: unknown): boolean {
  return (
    e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')
  );
}

async function dirAt(
  parts: string[],
  create: boolean,
  path: string,
  syscall: string,
): Promise<Dir> {
  let d = await root();
  for (const s of parts) {
    try {
      d = await d.getDirectoryHandle(s, { create });
    } catch (e) {
      if (isNotFound(e))
        throw err(
          e instanceof DOMException && e.name === 'TypeMismatchError' ? 'ENOTDIR' : 'ENOENT',
          syscall,
          path,
        );
      throw e;
    }
  }
  return d;
}

async function entry(
  path: string,
  syscall: string,
): Promise<{ parent: Dir; name: string; kind: 'file' | 'directory'; handle: FileHandle | Dir }> {
  const parts = segs(path);
  const name = parts.pop();
  const parent = await dirAt(parts, false, path, syscall);
  if (!name) return { parent, name: '', kind: 'directory', handle: parent };
  try {
    return { parent, name, kind: 'file', handle: await parent.getFileHandle(name) };
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  try {
    return { parent, name, kind: 'directory', handle: await parent.getDirectoryHandle(name) };
  } catch (e) {
    if (isNotFound(e)) throw err('ENOENT', syscall, path);
    throw e;
  }
}

function toBytes(data: unknown, enc?: BufferEncoding): Uint8Array {
  if (typeof data === 'string') return Uint8Array.from(Buffer.from(data, enc ?? 'utf8'));
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError('Unsupported data for writeFile');
}

function encodingOf(opts: unknown): BufferEncoding | undefined {
  if (typeof opts === 'string') return opts as BufferEncoding;
  if (opts && typeof opts === 'object' && 'encoding' in opts) {
    const e = (opts as { encoding?: unknown }).encoding;
    return typeof e === 'string' ? (e as BufferEncoding) : undefined;
  }
  return undefined;
}

async function writeWhole(parent: Dir, name: string, bytes: Uint8Array): Promise<void> {
  const fh = await parent.getFileHandle(name, { create: true });
  const w = await (
    fh as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }
  ).createWritable();
  await w.write(bytes as BufferSource);
  await w.close();
}

export interface StatLike {
  size: number;
  mtimeMs: number;
  mtime: Date;
  atimeMs: number;
  atime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
}

function statOf(
  path: string,
  kind: 'file' | 'directory',
  size: number,
  lastModified: number,
): StatLike {
  const m = mtimeOverrides.get(path) ?? lastModified;
  return {
    size,
    mtimeMs: m,
    mtime: new Date(m),
    atimeMs: m,
    atime: new Date(m),
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory',
  };
}

export const opfsDirect = {
  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<string | undefined> {
    const parts = segs(path);
    if (!opts?.recursive) {
      await dirAt(parts.slice(0, -1), false, path, 'mkdir');
    }
    await dirAt(parts, true, path, 'mkdir');
    return opts?.recursive ? path : undefined;
  },

  async readdir(path: string): Promise<string[]> {
    const d = await dirAt(segs(path), false, path, 'scandir');
    const names: string[] = [];
    for await (const name of (d as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (!name.endsWith('.crswap')) names.push(name);
    }
    return names;
  },

  async readFile(path: string, opts?: unknown): Promise<Buffer | string> {
    const e = await entry(path, 'open');
    if (e.kind !== 'file') throw err('EISDIR', 'read', path);
    const file = await (e.handle as FileHandle).getFile();
    const buf = Buffer.from(new Uint8Array(await file.arrayBuffer()));
    const enc = encodingOf(opts);
    return enc ? buf.toString(enc) : buf;
  },

  async writeFile(path: string, data: unknown, opts?: unknown): Promise<void> {
    const parts = segs(path);
    const name = parts.pop();
    if (!name) throw err('EISDIR', 'open', path);
    const parent = await dirAt(parts, false, path, 'open');
    await writeWhole(parent, name, toBytes(data, encodingOf(opts)));
    mtimeOverrides.delete(path);
  },

  async rename(from: string, to: string): Promise<void> {
    const src = await entry(from, 'rename');
    if (src.kind !== 'file') throw err('EISDIR', 'rename', from);
    const file = await (src.handle as FileHandle).getFile();
    const parts = segs(to);
    const name = parts.pop();
    if (!name) throw err('EISDIR', 'rename', to);
    const destDir = await dirAt(parts, false, to, 'rename');
    await writeWhole(destDir, name, new Uint8Array(await file.arrayBuffer()));
    await src.parent.removeEntry(src.name);
    mtimeOverrides.delete(from);
  },

  async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    try {
      const e = await entry(path, 'rm');
      if (!e.name) {
        for await (const name of (
          e.handle as unknown as { keys(): AsyncIterable<string> }
        ).keys()) {
          await (e.handle as Dir).removeEntry(name, { recursive: true });
        }
        return;
      }
      await e.parent.removeEntry(e.name, { recursive: opts?.recursive === true });
    } catch (e) {
      if (opts?.force && (e as { code?: string }).code === 'ENOENT') return;
      throw e;
    }
  },

  async unlink(path: string): Promise<void> {
    const e = await entry(path, 'unlink');
    if (e.kind !== 'file') throw err('EISDIR', 'unlink', path);
    await e.parent.removeEntry(e.name);
    mtimeOverrides.delete(path);
  },

  async stat(path: string): Promise<StatLike> {
    const e = await entry(path, 'stat');
    if (e.kind === 'directory') return statOf(path, 'directory', 0, 0);
    const file = await (e.handle as FileHandle).getFile();
    return statOf(path, 'file', file.size, file.lastModified);
  },

  async utimes(path: string, ...times: unknown[]): Promise<void> {
    await entry(path, 'utime');
    const mtime = times[1];
    const ms =
      mtime instanceof Date
        ? mtime.getTime()
        : typeof mtime === 'number'
          ? mtime * (mtime < 1e12 ? 1000 : 1)
          : Date.now();
    mtimeOverrides.set(path, ms);
  },

  async access(path: string): Promise<void> {
    await entry(path, 'access');
  },
};
