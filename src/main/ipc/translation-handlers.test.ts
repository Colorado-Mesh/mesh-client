import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { ipcMain, net } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertIpcSender } from '../validate-ipc-sender';
import {
  createTranslationPackFetch,
  registerTranslationHandlers,
  validateTranslationRequest,
} from './translation-handlers';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => fixture.directory, getVersion: () => '9.9.9' },
  ipcMain: { handle: vi.fn() },
  net: { fetch: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));
vi.mock('node:worker_threads', () => ({ Worker: vi.fn() }));
vi.mock('../validate-ipc-sender', () => ({ assertIpcSender: vi.fn() }));
describe('translation IPC', () => {
  let dispose: () => void;
  const settings = new Map<string, string>();
  const handler = (channel: string) => {
    const found = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel);
    if (!found) throw new Error(`Missing ${channel}`);
    return found[1] as (event: unknown, value?: unknown) => Promise<unknown>;
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    settings.clear();
    fixture.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-translation-ipc-'));
    dispose = registerTranslationHandlers({
      getSetting: (key) => settings.get(key),
      setSetting: (key, value) => {
        settings.set(key, value);
      },
      onProgress: vi.fn(),
    });
  });
  afterEach(async () => {
    dispose();
    await fs.rm(fixture.directory, { recursive: true, force: true });
  });
  it.each(['linux', 'darwin', 'win32'])(
    'keeps every default-disabled operation inert on %s',
    async () => {
      expect(await handler('translation:getStatus')({})).toMatchObject({ enabled: false });
      await handler('translation:listPacks')({});
      expect(
        await handler('translation:translate')(
          {},
          { text: 'Bonjour tout le monde', target: 'en', mode: 'manual' },
        ),
      ).toEqual({ ok: false, reason: 'disabled' });
      expect(await handler('translation:detect')({}, 'Bonjour tout le monde')).toBeNull();
      await handler('translation:installPack')({}, 'fr-en');
      await handler('translation:cancelInstall')({}, 'fr-en');
      await handler('translation:deletePack')({}, 'fr-en');
      await handler('translation:setLibreConfig')(
        {},
        { enabled: true, url: 'https://server.test' },
      );
      await handler('translation:testLibreConfig')({});
      await handler('translation:removeAll')({});
      expect(net.fetch).not.toHaveBeenCalled();
      expect(Worker).not.toHaveBeenCalled();
      expect(await fs.readdir(fixture.directory)).toEqual([]);
      expect(assertIpcSender).toHaveBeenCalledTimes(10);
    },
  );
  it('downloads packs with Node fetch and a mesh-client User-Agent instead of net.fetch', async () => {
    const nodeFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    );
    vi.stubGlobal('fetch', nodeFetch);
    try {
      settings.set('translationEnabled', '1');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await handler('translation:installPack')({}, 'fr-en')).toEqual({
        ok: false,
        reason: 'downloadFailed',
      });
      expect(nodeFetch).toHaveBeenCalled();
      const init = nodeFetch.mock.calls[0]?.[1];
      expect(new Headers(init?.headers).get('User-Agent')).toBe('mesh-client/9.9.9');
      expect(init?.redirect).toBe('error');
      expect(net.fetch).not.toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[1])).toContain('HTTP 503');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('keeps caller headers while overriding the pack User-Agent', async () => {
    const inner = vi.fn<typeof fetch>(() => Promise.resolve(new Response('ok')));
    await createTranslationPackFetch('1.2.3', inner)('https://cdn.test/a', {
      headers: { 'User-Agent': 'Chrome', Accept: '*/*' },
    });
    const headers = new Headers(inner.mock.calls[0]?.[1]?.headers);
    expect(headers.get('User-Agent')).toBe('mesh-client/1.2.3');
    expect(headers.get('Accept')).toBe('*/*');
  });
  it('validates primitive request mode/provider, text size, language and pack IDs', async () => {
    for (const bad of [
      { mode: ['auto'], provider: 'libre' },
      { mode: 'manual', provider: ['libre'] },
      { mode: 'manual', target: 'bad' },
      { mode: 'manual', text: 'x'.repeat(8193) },
    ])
      expect(() =>
        validateTranslationRequest({ text: 'hello world text', target: 'en', ...bad }),
      ).toThrow();
    await expect(handler('translation:installPack')({}, '../engine')).rejects.toThrow('Unknown');
    await expect(handler('translation:setEnabled')({}, '1')).rejects.toThrow('opt-in');
  });
  it('requires a trusted sender and enforces a shared read rate limit', async () => {
    vi.mocked(assertIpcSender).mockImplementationOnce(() => {
      throw new Error('unauthorized');
    });
    await expect(handler('translation:getStatus')({})).rejects.toThrow('unauthorized');
    for (let i = 0; i < 180; i++)
      await handler('translation:translate')(
        {},
        { text: 'hello world text', target: 'en', mode: 'auto' },
      );
    await expect(
      handler('translation:translate')(
        {},
        { text: 'hello world text', target: 'en', mode: 'auto' },
      ),
    ).rejects.toThrow();
  });
});
