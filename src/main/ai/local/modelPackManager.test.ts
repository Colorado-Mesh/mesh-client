/* eslint-disable @typescript-eslint/require-await -- deterministic async fetch/runtime test doubles */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiLocalModel } from './modelManifest';
import { AiModelPackManager } from './modelPackManager';

const data = Buffer.from('synthetic model');
const manifest: AiLocalModel[] = [
  {
    id: 'model-1',
    name: 'Test',
    paramsLabel: '1',
    qualityNote: 'compact',
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
