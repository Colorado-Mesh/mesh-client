import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpfsPersistBackend } from './fsPersistence';

/**
 * In-memory OPFS: directories, files with sync access handles, and `move()` that either replaces
 * an existing target in one step (Chromium) or refuses one (`refuse`). `failMoves` makes the
 * given move calls (1-based) throw, to stand in for an interruption at that step.
 */
class FakeFile {
  readonly kind = 'file';
  bytes = new Uint8Array();
  constructor(
    public name: string,
    public parent: FakeDir,
  ) {}
  createSyncAccessHandle() {
    return Promise.resolve({
      truncate: (n: number) => {
        this.bytes = this.bytes.slice(0, n);
      },
      write: (buf: Uint8Array, opts?: { at: number }) => {
        const at = opts?.at ?? 0;
        const next = new Uint8Array(Math.max(this.bytes.length, at + buf.length));
        next.set(this.bytes);
        next.set(buf, at);
        this.bytes = next;
        return buf.length;
      },
      flush: () => undefined,
      close: () => undefined,
    });
  }
  getFile() {
    const copy = this.bytes.slice();
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(copy.buffer) });
  }
  move(dir: FakeDir, name: string): Promise<void> {
    const fs = this.parent.fs;
    fs.moveCalls += 1;
    if (fs.failMoves.has(fs.moveCalls)) {
      return Promise.reject(new DOMException('interrupted', 'AbortError'));
    }
    if (fs.mode === 'refuse' && dir.children.has(name)) {
      return Promise.reject(new DOMException('exists', 'InvalidModificationError'));
    }
    this.parent.children.delete(this.name);
    dir.children.set(name, this);
    this.parent = dir;
    this.name = name;
    return Promise.resolve();
  }
}

class FakeDir {
  readonly kind = 'directory';
  readonly children = new Map<string, FakeDir | FakeFile>();
  constructor(readonly fs: FakeFs) {}
  getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    const found = this.children.get(name);
    if (found instanceof FakeDir) return Promise.resolve(found);
    if (found || !opts?.create) return Promise.reject(new DOMException(name, 'NotFoundError'));
    const d = new FakeDir(this.fs);
    this.children.set(name, d);
    return Promise.resolve(d);
  }
  getFileHandle(name: string, opts?: { create?: boolean }) {
    const found = this.children.get(name);
    if (found instanceof FakeFile) return Promise.resolve(found);
    if (found || !opts?.create) return Promise.reject(new DOMException(name, 'NotFoundError'));
    const f = new FakeFile(name, this);
    this.children.set(name, f);
    return Promise.resolve(f);
  }
  removeEntry(name: string) {
    if (!this.children.delete(name)) return Promise.reject(new DOMException(name, 'NotFoundError'));
    return Promise.resolve();
  }
  async *entries(): AsyncIterable<[string, FakeDir | FakeFile]> {
    for (const entry of [...this.children]) yield await Promise.resolve(entry);
  }
}

class FakeFs {
  moveCalls = 0;
  failMoves = new Set<number>();
  readonly root = new FakeDir(this);
  constructor(public mode: 'replace' | 'refuse') {}
  /** Names in the backend's own folder. */
  names(): string[] {
    const dir = this.root.children.get('mesh-fs');
    return dir instanceof FakeDir ? [...dir.children.keys()].sort() : [];
  }
  dir(): FakeDir {
    const dir = this.root.children.get('mesh-fs');
    if (!(dir instanceof FakeDir)) throw new Error('backend folder missing');
    return dir;
  }
}

const text = (s: string) => new TextEncoder().encode(s);
const read = (b?: Uint8Array) => new TextDecoder().decode(b);

async function filesOf(backend: OpfsPersistBackend): Promise<Record<string, string>> {
  const all = await backend.loadAll();
  return Object.fromEntries(
    all.filter((e) => e.kind === 'file').map((e) => [e.path, read(e.bytes)]),
  );
}

let fs: FakeFs;
function useFs(mode: 'replace' | 'refuse') {
  fs = new FakeFs(mode);
  vi.stubGlobal('navigator', { storage: { getDirectory: () => Promise.resolve(fs.root) } });
}

beforeEach(() => {
  useFs('replace');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpfsPersistBackend.writeFile', () => {
  it.each(['replace', 'refuse'] as const)(
    'replaces a file and leaves no side copy (%s)',
    async (mode) => {
      useFs(mode);
      const backend = new OpfsPersistBackend();
      await backend.writeFile('/settings.json', text('v1'));
      await backend.writeFile('/settings.json', text('v2'));
      expect(await filesOf(backend)).toEqual({ '/settings.json': 'v2' });
      expect(fs.names()).toEqual(['settings.json']);
    },
  );

  it('recovers from one failed move by swapping through the side copy', async () => {
    const backend = new OpfsPersistBackend();
    await backend.writeFile('/settings.json', text('v1'));
    fs.failMoves.add(fs.moveCalls + 1);
    await backend.writeFile('/settings.json', text('v2'));
    expect(await filesOf(new OpfsPersistBackend())).toEqual({ '/settings.json': 'v2' });
    expect(fs.names()).toEqual(['settings.json']);
  });

  it('keeps the previous file when moving the new one into place keeps failing', async () => {
    const backend = new OpfsPersistBackend();
    await backend.writeFile('/settings.json', text('v1'));
    // Moves of this write: 1 direct (fails), 2 previous aside, 3 new into place (fails), 4 back.
    fs.failMoves.add(fs.moveCalls + 1);
    fs.failMoves.add(fs.moveCalls + 3);
    await expect(backend.writeFile('/settings.json', text('v2'))).rejects.toThrow('interrupted');
    expect(await filesOf(new OpfsPersistBackend())).toEqual({ '/settings.json': 'v1' });
  });

  it('puts the previous file back when the swap fails on a platform that will not replace', async () => {
    useFs('refuse');
    const backend = new OpfsPersistBackend();
    await backend.writeFile('/settings.json', text('v1'));
    // Moves of this write: 1 refused (target exists), 2 previous aside, 3 new into place (fails).
    fs.failMoves.add(fs.moveCalls + 3);
    await expect(backend.writeFile('/settings.json', text('v2'))).rejects.toThrow('interrupted');
    expect(await filesOf(new OpfsPersistBackend())).toEqual({ '/settings.json': 'v1' });
  });
});

describe('OpfsPersistBackend.loadAll', () => {
  it('restores the previous version when a swap stopped between its two moves', async () => {
    const backend = new OpfsPersistBackend();
    await backend.writeFile('/settings.json', text('v1'));
    // State after "previous moved aside" and before "new moved in": the worker was stopped.
    const dir = fs.dir();
    const previous = dir.children.get('settings.json') as FakeFile;
    dir.children.delete('settings.json');
    previous.name = 'settings.json.mesh-prev';
    dir.children.set(previous.name, previous);
    const tmp = new FakeFile('settings.json.tmp', dir);
    tmp.bytes = text('v2-maybe-partial');
    dir.children.set(tmp.name, tmp);

    expect(await filesOf(new OpfsPersistBackend())).toEqual({ '/settings.json': 'v1' });
  });

  it('drops a stale previous copy when its file is present', async () => {
    const backend = new OpfsPersistBackend();
    await backend.writeFile('/settings.json', text('v2'));
    const dir = fs.dir();
    const stale = new FakeFile('settings.json.mesh-prev', dir);
    stale.bytes = text('v1');
    dir.children.set(stale.name, stale);

    expect(await filesOf(new OpfsPersistBackend())).toEqual({ '/settings.json': 'v2' });
    expect(fs.names()).toEqual(['settings.json']);
  });

  it('never loads a lone .tmp (it may be a partial first write)', async () => {
    const backend = new OpfsPersistBackend();
    await backend.mkdir('/');
    const dir = fs.dir();
    const tmp = new FakeFile('new.json.tmp', dir);
    tmp.bytes = text('partial');
    dir.children.set(tmp.name, tmp);
    expect(await filesOf(new OpfsPersistBackend())).toEqual({});
  });
});
