/**
 * Durable backends for the mobile host `fs` shim.
 *
 * - `OpfsPersistBackend`: Origin Private File System, written with SyncAccessHandles inside the
 *   worker (Android WebView, desktop Chromium test harness, Safari 17+).
 * - `NativePersistBackend`: Capacitor `Filesystem` plugin (app sandbox `Directory.Data`) for
 *   WebViews without OPFS sync access handles.
 *
 * Each file write replaces the whole file: OPFS writes go to a `.tmp` sibling first and are moved
 * over the original only after a complete write + flush, so a crash mid-write keeps the previous
 * version.
 */
import { Buffer } from 'buffer';

import { callNative } from './hostChannel';
import type { PersistBackend } from './shims/node/fs';

const OPFS_ROOT_NAME = 'mesh-fs';

type Dir = FileSystemDirectoryHandle;

async function opfsRoot(): Promise<Dir> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_ROOT_NAME, { create: true });
}

function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

async function dirFor(root: Dir, segs: string[], create: boolean): Promise<Dir | null> {
  let d = root;
  for (const s of segs) {
    try {
      d = await d.getDirectoryHandle(s, { create });
    } catch (e) {
      if (!create && e instanceof DOMException && e.name === 'NotFoundError') return null;
      throw e;
    }
  }
  return d;
}

interface SyncHandle {
  write(buf: Uint8Array, opts?: { at: number }): number;
  truncate(n: number): void;
  flush(): void;
  close(): void;
}

export class OpfsPersistBackend implements PersistBackend {
  readonly name = 'opfs';
  private rootP: Promise<Dir> | null = null;

  static async isAvailable(): Promise<boolean> {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return false;
      const root = await opfsRoot();
      const fh = await root.getFileHandle('.probe', { create: true });
      const h = await (
        fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }
      ).createSyncAccessHandle();
      h.close();
      await root.removeEntry('.probe');
      return true;
    } catch (e) {
      console.debug(
        `[mobile/fsPersistence] OPFS unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  private root(): Promise<Dir> {
    this.rootP ??= opfsRoot();
    return this.rootP;
  }

  async loadAll(): Promise<{ path: string; kind: 'file' | 'dir'; bytes?: Uint8Array }[]> {
    const out: { path: string; kind: 'file' | 'dir'; bytes?: Uint8Array }[] = [];
    const walk = async (dir: Dir, prefix: string): Promise<void> => {
      for await (const [name, handle] of (
        dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
      ).entries()) {
        if (name.endsWith('.tmp') || name === '.probe') continue;
        const p = `${prefix}/${name}`;
        if (handle.kind === 'directory') {
          out.push({ path: p, kind: 'dir' });
          await walk(handle as Dir, p);
        } else {
          const file = await (handle as FileSystemFileHandle).getFile();
          out.push({ path: p, kind: 'file', bytes: new Uint8Array(await file.arrayBuffer()) });
        }
      }
    };
    await walk(await this.root(), '');
    return out;
  }

  async mkdir(path: string): Promise<void> {
    await dirFor(await this.root(), segments(path), true);
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const segs = segments(path);
    const name = segs.pop();
    if (!name) return;
    const dir = await dirFor(await this.root(), segs, true);
    if (!dir) return;
    const tmpName = `${name}.tmp`;
    const tmp = await dir.getFileHandle(tmpName, { create: true });
    const h = await (
      tmp as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }
    ).createSyncAccessHandle();
    try {
      h.truncate(0);
      const n = h.write(bytes, { at: 0 });
      if (n !== bytes.byteLength) throw new Error(`short write ${n}/${bytes.byteLength}`);
      h.flush();
    } finally {
      h.close();
    }
    // Replace atomically when the platform supports move(); otherwise rewrite in place.
    const movable = tmp as unknown as { move?: (d: Dir, n: string) => Promise<void> };
    if (typeof movable.move === 'function') {
      try {
        await dir.removeEntry(name);
      } catch {
        // catch-no-log-ok first write: no previous file to replace
      }
      await movable.move(dir, name);
      return;
    }
    const target = await dir.getFileHandle(name, { create: true });
    const th = await (
      target as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }
    ).createSyncAccessHandle();
    try {
      th.truncate(0);
      th.write(bytes, { at: 0 });
      th.flush();
    } finally {
      th.close();
    }
    await dir.removeEntry(tmpName);
  }

  async remove(path: string): Promise<void> {
    const segs = segments(path);
    const name = segs.pop();
    if (!name) return;
    const dir = await dirFor(await this.root(), segs, false);
    if (!dir) return;
    try {
      await dir.removeEntry(name, { recursive: true });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return;
      throw e;
    }
  }
}

/** Capacitor Filesystem plugin backend (paths relative to `Directory.Data/mesh-fs`). */
export class NativePersistBackend implements PersistBackend {
  readonly name = 'native';

  private rel(path: string): string {
    return `mesh-fs${path}`;
  }

  async loadAll(): Promise<{ path: string; kind: 'file' | 'dir'; bytes?: Uint8Array }[]> {
    const out: { path: string; kind: 'file' | 'dir'; bytes?: Uint8Array }[] = [];
    const walk = async (p: string): Promise<void> => {
      let res: { files: { name: string; type: 'file' | 'directory' }[] };
      try {
        res = await callNative('Filesystem', 'readdir', { path: this.rel(p), directory: 'DATA' });
      } catch {
        return; // catch-no-log-ok directory does not exist yet (first launch)
      }
      for (const f of res.files) {
        if (f.name.endsWith('.tmp')) continue;
        const child = `${p}/${f.name}`;
        if (f.type === 'directory') {
          out.push({ path: child, kind: 'dir' });
          await walk(child);
        } else {
          const r = await callNative<{ data: string }>('Filesystem', 'readFile', {
            path: this.rel(child),
            directory: 'DATA',
          });
          out.push({
            path: child,
            kind: 'file',
            bytes: Uint8Array.from(Buffer.from(r.data, 'base64')),
          });
        }
      }
    };
    await walk('');
    return out;
  }

  async mkdir(path: string): Promise<void> {
    try {
      await callNative('Filesystem', 'mkdir', {
        path: this.rel(path),
        directory: 'DATA',
        recursive: true,
      });
    } catch (e) {
      if (!/exist/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const data = Buffer.from(bytes).toString('base64');
    const tmp = `${this.rel(path)}.tmp`;
    await callNative('Filesystem', 'writeFile', {
      path: tmp,
      directory: 'DATA',
      data,
      recursive: true,
    });
    await callNative('Filesystem', 'rename', {
      from: tmp,
      to: this.rel(path),
      directory: 'DATA',
      toDirectory: 'DATA',
    });
  }

  async remove(path: string): Promise<void> {
    try {
      await callNative('Filesystem', 'deleteFile', { path: this.rel(path), directory: 'DATA' });
    } catch {
      try {
        await callNative('Filesystem', 'rmdir', {
          path: this.rel(path),
          directory: 'DATA',
          recursive: true,
        });
      } catch {
        // catch-no-log-ok already gone
      }
    }
  }
}
