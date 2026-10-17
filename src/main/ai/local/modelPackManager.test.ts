import { execFileSync } from 'node:child_process';
/* eslint-disable @typescript-eslint/require-await -- deterministic async fetch/runtime test doubles */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiLocalModel } from './modelManifest';
import { AiModelPackManager } from './modelPackManager';

const data = Buffer.from('synthetic model');
const hashReads = vi.fn((file: string) => createReadStream(file));
const manifest: AiLocalModel[] = [
  {
    id: 'model-1',
    name: 'Test',
    paramsLabel: '1',
    license: 'MIT',
    assets: [
      {
        file: 'model.gguf',
        url: 'https://model.test/model',
        size: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      },
    ],
  },
];
let temp: string;
beforeEach(async () => {
  hashReads.mockClear();
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-ai-'));
});
afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});
const create = (fetchImpl: typeof fetch, enabled = () => true) =>
  new AiModelPackManager({
    directory: () => path.join(temp, 'models'),
    enabled,
    fetch: fetchImpl,
    onProgress: vi.fn(),
    manifest,
    openHashStream: hashReads,
  });
describe('AI verified model downloads', () => {
  it.each(['linux', 'darwin', 'win32'])('keeps disabled state inert on %s', async () => {
    const fetchImpl = vi.fn();
    const packs = create(fetchImpl, () => false);
    expect(await packs.install('model-1')).toEqual({ ok: false, reason: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await fs.readdir(temp)).toEqual([]);
    expect(() => packs.assetPath('../model', 'model.gguf')).toThrow();
  });
  it('releases a rejected download response without publishing a model', async () => {
    const cancel = vi.fn();
    const packs = create(async () => new Response(new ReadableStream({ cancel }), { status: 503 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await packs.install('model-1')).toMatchObject({ ok: false });
      expect(cancel).toHaveBeenCalledOnce();
      expect(await packs.verify('model-1')).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
  it('streams, verifies, atomically publishes and removes models', async () => {
    const packs = create(async () => new Response(data));
    expect(await packs.install('model-1')).toEqual({ ok: true });
    expect(await packs.verify('model-1')).toBe(true);
    await fs.writeFile(packs.assetPath('model-1', 'model.gguf'), Buffer.from('corrupt'));
    expect(await packs.verify('model-1')).toBe(false);
    await packs.delete('model-1');
    expect(await fs.readdir(path.join(temp, 'models'))).toEqual([]);
  });
  it.each(['linux', 'darwin', 'win32'])(
    'verifies inline attribution with model assets on %s',
    async () => {
      const notice = 'Synthetic attribution\n';
      const fetchImpl = vi.fn(async () => new Response(data));
      const packs = new AiModelPackManager({
        directory: () => path.join(temp, 'models'),
        enabled: () => true,
        fetch: fetchImpl,
        onProgress: vi.fn(),
        manifest: [
          {
            ...manifest[0],
            assets: [
              ...manifest[0].assets,
              {
                file: 'NOTICE.txt',
                content: notice,
                size: Buffer.byteLength(notice),
                sha256: createHash('sha256').update(notice).digest('hex'),
              },
            ],
          },
        ],
      });
      expect(await packs.install('model-1')).toEqual({ ok: true });
      expect(fetchImpl).toHaveBeenCalledOnce();
      const noticePath = packs.assetPath('model-1', 'NOTICE.txt');
      expect(await fs.readFile(noticePath, 'utf8')).toBe(notice);
      expect(await packs.verify('model-1')).toBe(true);
      await fs.writeFile(noticePath, notice.replace('Synthetic', 'Incorrect'));
      expect(await packs.verify('model-1')).toBe(false);
    },
  );
  it('does not publish mismatched bytes and cancellation cannot resurrect a removed model', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const bad = create(async () => new Response(Buffer.alloc(data.length)));
      expect(await bad.install('model-1')).toMatchObject({ ok: false });
      expect(await bad.verify('model-1')).toBe(false);
      let release: () => void = () => {};
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const packs = create(async () => {
        await wait;
        return new Response(data);
      });
      const install = packs.install('model-1');
      const removal = packs.delete('model-1');
      release();
      await Promise.all([install, removal]);
      expect(await packs.verify('model-1')).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

it.each(['linux', 'darwin', 'win32'])(
  'uses advisory catalog metadata but hashes again before runtime use on %s',
  async () => {
    const packs = create(async () => new Response(data));
    expect(await packs.install('model-1')).toEqual({ ok: true });
    expect(await packs.verify('model-1')).toBe(true);
    hashReads.mockClear();
    try {
      const restarted = create(vi.fn());
      expect((await restarted.list())[0].installed).toBe(true);
      expect(hashReads).not.toHaveBeenCalled();
      expect(await restarted.verify('model-1')).toBe(true);
      expect(hashReads).toHaveBeenCalledOnce();
      await fs.writeFile(packs.assetPath('model-1', 'model.gguf'), Buffer.alloc(data.length));
      expect(await restarted.verify('model-1')).toBe(false);
      const third = create(vi.fn());
      expect((await third.list())[0].installed).toBe(false);
      expect(await third.verify('model-1')).toBe(false);
    } finally {
      hashReads.mockClear();
    }
  },
);
it('recovers from corrupt advisory metadata and rejects forged metadata before runtime use', async () => {
  const packs = create(async () => new Response(data));
  await packs.install('model-1');
  await packs.verify('model-1');
  const cache = path.join(temp, 'models/model-1/.verified.json');
  await fs.writeFile(cache, '{');
  expect((await create(vi.fn()).list())[0].installed).toBe(true);
  await fs.writeFile(packs.assetPath('model-1', 'model.gguf'), Buffer.alloc(data.length));
  const stat = await fs.lstat(packs.assetPath('model-1', 'model.gguf'));
  const signature = `${manifest[0].assets[0].sha256}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  await fs.writeFile(cache, JSON.stringify({ signature }));
  const restarted = create(vi.fn());
  expect((await restarted.list())[0].installed).toBe(true);
  expect(await restarted.verify('model-1')).toBe(false);
});
it('throttles byte progress while delivering every state transition and final bytes', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const onProgress = vi.fn();
  const packs = new AiModelPackManager({
    directory: () => path.join(temp, 'models'),
    enabled: () => true,
    manifest,
    onProgress,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of data) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
      ),
  });
  expect(await packs.install('model-1')).toEqual({ ok: true });
  const events = onProgress.mock.calls.map(
    ([value]) => value as { state: string; receivedBytes: number },
  );
  expect(events.map((event) => event.state)).toEqual([
    'queued',
    'downloading',
    'verifying',
    'installed',
  ]);
  expect(events.at(-1)?.receivedBytes).toBe(data.length);
  now.mockRestore();
});

it('rehashes instead of trusting an oversized advisory record', async () => {
  const packs = create(async () => new Response(data));
  await packs.install('model-1');
  await packs.verify('model-1');
  await fs.writeFile(path.join(temp, 'models/model-1/.verified.json'), 'x'.repeat(16384));
  hashReads.mockClear();
  expect((await create(vi.fn()).list())[0].installed).toBe(true);
  expect(hashReads).toHaveBeenCalledOnce();
});
// OS-specific: creating file symlinks on Windows requires privileges unavailable to normal test runs.
it.skipIf(process.platform === 'win32')(
  'rehashes instead of following advisory metadata symlinks',
  async () => {
    const packs = create(async () => new Response(data));
    await packs.install('model-1');
    await packs.verify('model-1');
    const cache = path.join(temp, 'models/model-1/.verified.json');
    const external = path.join(temp, 'record.json');
    await fs.rename(cache, external);
    await fs.symlink(external, cache);
    hashReads.mockClear();
    expect((await create(vi.fn()).list())[0].installed).toBe(true);
    expect(hashReads).toHaveBeenCalledOnce();
  },
);

// OS-specific: named pipes are Unix filesystem objects; Windows uses a different pipe namespace.
it.skipIf(process.platform === 'win32')(
  'does not block on a named pipe used as advisory metadata',
  async () => {
    const packs = create(async () => new Response(data));
    await packs.install('model-1');
    await packs.verify('model-1');
    const cache = path.join(temp, 'models/model-1/.verified.json');
    await fs.unlink(cache);
    execFileSync('mkfifo', [cache]);
    hashReads.mockClear();
    expect((await create(vi.fn()).list())[0].installed).toBe(true);
    expect(hashReads).toHaveBeenCalledOnce();
  },
);

it.each([false, true])(
  'shares stalled hash work without trusting corrupt bytes (corrupt=%s)',
  async (corrupt) => {
    const installed = create(async () => new Response(data));
    await installed.install('model-1');
    if (corrupt)
      await fs.writeFile(installed.assetPath('model-1', 'model.gguf'), Buffer.alloc(data.length));
    await fs.rm(path.join(temp, 'models/model-1/.verified.json'), { force: true });
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const openHashStream = vi.fn(async function* (file: string) {
      await wait;
      yield* createReadStream(file);
    });
    const restarted = new AiModelPackManager({
      directory: () => path.join(temp, 'models'),
      enabled: () => true,
      fetch: vi.fn(),
      onProgress: vi.fn(),
      manifest,
      openHashStream,
    });
    const first = restarted.verify('model-1', true);
    await vi.waitFor(() => {
      expect(openHashStream).toHaveBeenCalledOnce();
    });
    const runtime = restarted.verify('model-1');
    const secondStatus = restarted.verify('model-1', true);
    // Let stat/advisory reads reach the shared pending hash before releasing it.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(openHashStream).toHaveBeenCalledOnce();
    release();
    expect(await Promise.all([first, runtime, secondStatus])).toEqual([
      !corrupt,
      !corrupt,
      !corrupt,
    ]);
    expect(openHashStream).toHaveBeenCalledOnce();
  },
);
