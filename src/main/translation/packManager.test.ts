import { createHash } from 'node:crypto';
import { readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TranslationPackManager } from './packManager';
import type { TranslationManifestPack } from './translationManifest';

const data = Buffer.from('verified model bytes');
const compressed = zstdCompressSync(data);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const manifest: TranslationManifestPack[] = [
  {
    id: 'fr-en',
    source: 'fr',
    target: 'en',
    license: 'MPL-2.0',
    assets: [
      {
        file: 'model.bin',
        url: 'https://models.example/model.zst',
        size: compressed.length,
        sha256: sha(compressed),
        decodedSize: data.length,
        decodedSha256: sha(data),
      },
    ],
  },
];
describe('translation pack manager', () => {
  let temp: string;
  beforeEach(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-translation-'));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(temp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  const directory = () => path.join(temp, 'translation');
  const create = (fetchImpl: typeof fetch, enabled = true) =>
    new TranslationPackManager({
      directory,
      enabled: () => enabled,
      fetch: fetchImpl,
      onProgress: vi.fn(),
      manifest,
    });
  it.each(['linux', 'darwin', 'win32'])(
    'publishes only verified complete packs on %s',
    async () => {
      const progress = vi.fn();
      const fetchImpl = vi.fn(async () => {
        expect(await fs.readdir(directory())).not.toContain('fr-en');
        return new Response(compressed);
      });
      const manager = new TranslationPackManager({
        directory,
        enabled: () => true,
        fetch: fetchImpl,
        onProgress: progress,
        manifest,
      });
      const first = manager.install('fr-en');
      expect(manager.install('fr-en')).toBe(first);
      expect(await first).toEqual({ ok: true });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(await fs.readFile(manager.assetPath('fr-en', 'model.bin'))).toEqual(data);
      expect(await manager.verify('fr-en')).toBe(true);
      expect(progress).toHaveBeenLastCalledWith({
        packId: 'fr-en',
        receivedBytes: compressed.length,
        totalBytes: compressed.length,
        state: 'installed',
      });
      await fs.writeFile(manager.assetPath('fr-en', 'model.bin'), Buffer.alloc(data.length));
      expect(await manager.verify('fr-en')).toBe(false);
      await manager.delete('fr-en');
      expect(await fs.readdir(directory())).toEqual([]);
      await manager.removeAll();
      await expect(fs.stat(directory())).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
  it('does no I/O until enabled and rejects path traversal', async () => {
    const fetchImpl = vi.fn();
    const manager = create(fetchImpl, false);
    expect(await manager.install('fr-en')).toEqual({ ok: false, reason: 'disabled' });
    expect(await manager.list()).toMatchObject([{ installed: false }]);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(fs.stat(directory())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => manager.install('../fr-en')).toThrow('Unknown');
    expect(() => manager.assetPath('fr-en', '../model.bin')).toThrow();
  });
  it.each(['compressed', 'raw'])(
    'publishes verified %s bytes despite a pathname replacement',
    async (kind) => {
      let replaced = false;
      const bytes = kind === 'compressed' ? compressed : data;
      const testedManifest =
        kind === 'compressed'
          ? manifest
          : [
              {
                ...manifest[0],
                assets: [
                  {
                    file: 'model.bin',
                    url: 'https://models.example/model.bin',
                    size: data.length,
                    sha256: sha(data),
                  },
                ],
              },
            ];
      const manager = new TranslationPackManager({
        directory,
        enabled: () => true,
        fetch: vi.fn(() => Promise.resolve(new Response(bytes))),
        onProgress: (progress) => {
          if (progress.state !== 'verifying') return;
          const temporary = readdirSync(directory()).find((entry) => entry.startsWith('.install-'));
          expect(temporary).toBeDefined();
          if (!temporary) throw new Error('Missing download directory');
          const raw = path.join(directory(), temporary, 'model.bin.download');
          const original = `${raw}.original`;
          renameSync(raw, original);
          writeFileSync(raw, Buffer.alloc(bytes.length));
          unlinkSync(original);
          replaced = true;
        },
        manifest: testedManifest,
      });
      expect(await manager.install('fr-en')).toEqual({ ok: true });
      expect(replaced).toBe(true);
      expect(await fs.readFile(manager.assetPath('fr-en', 'model.bin'))).toEqual(data);
      expect(await manager.verify('fr-en')).toBe(true);
    },
  );
  it('allows steady download progress beyond the inactivity deadline and clears its timer', async () => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let downloading!: () => void;
    const started = new Promise<void>((resolve) => {
      downloading = resolve;
    });
    let received!: () => void;
    const firstChunk = new Promise<void>((resolve) => {
      received = resolve;
    });
    const manager = new TranslationPackManager({
      directory,
      enabled: () => true,
      fetch: vi.fn((_input, options) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(stream) {
                controller = stream;
                options?.signal?.addEventListener('abort', () => {
                  stream.error(options.signal?.reason);
                });
              },
            }),
          ),
        ),
      ),
      onProgress: (progress) => {
        if (progress.state !== 'downloading') return;
        if (progress.receivedBytes === 0) downloading();
        else received();
      },
      manifest,
      timeoutMs: 1000,
    });
    const install = manager.install('fr-en');
    await started;
    await vi.advanceTimersByTimeAsync(900);
    controller.enqueue(compressed.subarray(0, 1));
    await firstChunk;
    await vi.advanceTimersByTimeAsync(900);
    controller.enqueue(compressed.subarray(1));
    controller.close();
    expect(await install).toEqual({ ok: true });
    expect(await manager.verify('fr-en')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts stalled downloads and clears their partial files and inactivity timer', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let downloading!: () => void;
    const started = new Promise<void>((resolve) => {
      downloading = resolve;
    });
    const manager = new TranslationPackManager({
      directory,
      enabled: () => true,
      fetch: vi.fn((_input, options) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(stream) {
                options?.signal?.addEventListener('abort', () => {
                  stream.error(options.signal?.reason);
                });
              },
            }),
          ),
        ),
      ),
      onProgress: (progress) => {
        if (progress.state === 'downloading') downloading();
      },
      manifest,
      timeoutMs: 1000,
    });
    const install = manager.install('fr-en');
    await started;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await install).toEqual({ ok: false, reason: 'downloadFailed' });
    expect(await fs.readdir(directory())).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['hash', 'network', 'size'])('cleans a failed %s download', async (failure) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = create(
      vi.fn(() => {
        if (failure === 'network') throw new Error('bad\nforged');
        return Promise.resolve(
          new Response(failure === 'size' ? Buffer.alloc(100) : Buffer.alloc(compressed.length)),
        );
      }),
    );
    expect((await manager.install('fr-en')).ok).toBe(false);
    expect(await fs.readdir(directory())).toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('\n');
  });
  it('cancels in-flight downloads and cleans partial files', async () => {
    let fetching!: () => void;
    const started = new Promise<void>((resolve) => {
      fetching = resolve;
    });
    const manager = create(
      vi.fn(async (_input, options) => {
        fetching();
        return new Promise<Response>((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          }),
        );
      }),
    );
    const install = manager.install('fr-en');
    await started;
    await manager.cancel('fr-en');
    expect(await install).toEqual({ ok: false, reason: 'cancelled' });
    expect(await fs.readdir(directory())).toEqual([]);
  });

  it.each(['delete', 'removeAll'] as const)(
    'serializes %s with publication and cannot resurrect a cancelled pack',
    async (operation) => {
      const rename = fs.rename.bind(fs);
      let resume!: () => void;
      let reached!: () => void;
      const publishing = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        resume = resolve;
      });
      vi.spyOn(fs, 'rename').mockImplementationOnce(async (...args) => {
        reached();
        await barrier;
        await rename(...args);
      });
      const manager = create(vi.fn(() => Promise.resolve(new Response(compressed))));
      const install = manager.install('fr-en');
      await publishing;
      const deletion = operation === 'delete' ? manager.delete('fr-en') : manager.removeAll();
      resume();
      expect(await install).toEqual({ ok: false, reason: 'cancelled' });
      await deletion;
      expect(await manager.verify('fr-en')).toBe(false);
      if (operation === 'removeAll')
        await expect(fs.stat(directory())).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await manager.install('fr-en')).toEqual({ ok: true });
      expect(await manager.verify('fr-en')).toBe(true);
    },
  );

  it('closes the download file even when cancelling the response stream throws', async () => {
    const open = fs.open.bind(fs);
    const closed = vi.fn();
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        closed();
        await close();
      });
      return handle;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = create(
      vi.fn(() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(Buffer.alloc(compressed.length + 1));
              },
              cancel() {
                throw new Error('stream cleanup failed');
              },
            }),
          ),
        ),
      ),
    );
    expect((await manager.install('fr-en')).ok).toBe(false);
    expect(closed).toHaveBeenCalled();
    expect(await fs.readdir(directory())).toEqual([]);
  });
});
