import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ipcMain, net } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertIpcSender } from '../validate-ipc-sender';
import { registerAiHandlers } from './ai-handlers';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({
  app: {
    getPath: () => fixture.directory,
    getAppPath: () => fixture.directory,
    isPackaged: false,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: vi.fn() },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
vi.mock('../validate-ipc-sender', () => ({ assertIpcSender: vi.fn() }));
vi.mock('../db-ipc-lifecycle', () => ({ getDbForIpc: vi.fn() }));
let dispose: () => void;
const settings = new Map<string, string>();
const send = vi.fn();
function handler(name: string) {
  const found = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === name);
  if (!found) throw new Error(name);
  return found[1] as (event: unknown, value?: unknown) => Promise<unknown>;
}
const request = {
  requestId: 'id',
  conversationLabel: 'chat',
  protocol: 'meshcore',
  surface: 'channel',
  locale: 'en',
  scope: { kind: 'unread' },
  messages: [{ at: 1, sender: 'Alice', body: 'private transcript' }],
};
beforeEach(async () => {
  vi.clearAllMocks();
  settings.clear();
  fixture.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-ai-ipc-'));
  dispose = registerAiHandlers({
    getSetting: (key) => settings.get(key),
    setSetting: (key, value) => {
      settings.set(key, value);
    },
    getWebContents: () => ({ isDestroyed: () => false, send }) as unknown as Electron.WebContents,
  });
});
afterEach(async () => {
  dispose();
  await fs.rm(fixture.directory, { recursive: true, force: true });
});
describe('AI IPC lifecycle and opt-in', () => {
  it.each(['linux', 'darwin', 'win32'])('keeps disabled operations inert on %s', async () => {
    expect(await handler('ai:getStatus')({})).toMatchObject({ enabled: false, engine: null });
    expect(await handler('ai:summarize')({}, request)).toEqual({ ok: false, reason: 'disabled' });
    expect(await handler('ai:listLocalModels')({})).toEqual([]);
    expect(await handler('ai:installLocalModel')({}, 'qwen2.5-0.5b-instruct-q4')).toEqual({
      ok: false,
      reason: 'disabled',
    });
    await handler('ai:probeOsAi')({});
    expect(net.fetch).not.toHaveBeenCalled();
    expect(await fs.readdir(fixture.directory)).toEqual([]);
  });
  it('guards sender, validates IPC shapes and refuses remote HTTP or unacknowledged endpoint', async () => {
    vi.mocked(assertIpcSender).mockImplementationOnce(() => {
      throw new Error('unauthorized');
    });
    await expect(handler('ai:getStatus')({})).rejects.toThrow('unauthorized');
    await handler('ai:setEnabled')({}, true);
    await expect(handler('ai:setEnabled')({}, 'true')).rejects.toThrow();
    for (const c of [
      { baseUrl: 'http://public.test', allowRemote: true },
      { baseUrl: 'https://public.test', allowRemote: false },
    ])
      await expect(
        handler('ai:setConfig')(
          {},
          { engine: 'remote', wireFormat: 'openai', model: 'test', ...c },
        ),
      ).rejects.toThrow();
    expect(net.fetch).not.toHaveBeenCalled();
  });
  it('streams exactly one terminal event and hides stored API keys', async () => {
    await handler('ai:setEnabled')({}, true);
    const status = await handler('ai:setConfig')(
      {},
      {
        engine: 'remote',
        wireFormat: 'openai',
        model: 'test',
        baseUrl: 'https://provider.test',
        allowRemote: true,
        apiKey: 'secret',
      },
    );
    expect(status).toMatchObject({ hasApiKey: true });
    expect(JSON.stringify(status)).not.toContain('secret');
    vi.mocked(net.fetch).mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"summary"}}]}\n\ndata: [DONE]\n\n'),
    );
    expect(await handler('ai:summarize')({}, request)).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        'ai:summaryDone',
        expect.objectContaining({ text: 'summary', messageCount: 1 }),
      );
    });
    expect(
      send.mock.calls.filter(
        ([channel]) => channel === 'ai:summaryDone' || channel === 'ai:summaryError',
      ),
    ).toHaveLength(1);
  });
  it('aborts pending requests and prevents late completion after disable', async () => {
    await handler('ai:setEnabled')({}, true);
    await handler('ai:setConfig')(
      {},
      { engine: 'local', wireFormat: 'openai', model: 'test', baseUrl: 'http://127.0.0.1:1234' },
    );
    vi.mocked(net.fetch).mockImplementation(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('private provider detail'));
            },
            { once: true },
          );
        }),
    );
    await handler('ai:summarize')({}, request);
    await vi.waitFor(() => {
      expect(net.fetch).toHaveBeenCalled();
    });
    await handler('ai:setEnabled')({}, false);
    await Promise.resolve();
    expect(send.mock.calls.filter(([channel]) => channel === 'ai:summaryDone')).toHaveLength(0);
  });
});
