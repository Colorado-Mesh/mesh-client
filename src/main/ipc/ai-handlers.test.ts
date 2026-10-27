import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ipcMain, net } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiModelPackManager } from '../ai/local/modelPackManager';
import { assertIpcSender } from '../validate-ipc-sender';
import { registerAiHandlers } from './ai-handlers';

const fixture = vi.hoisted(() => ({ directory: '', fetch: vi.fn() }));
vi.mock('electron', () => ({
  app: {
    getPath: () => fixture.directory,
    getAppPath: () => fixture.directory,
    isPackaged: false,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: vi.fn() },
  net: { fetch: fixture.fetch },
  protocol: { handle: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
vi.mock('undici', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('undici');
  return { ...actual, fetch: fixture.fetch };
});
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(() => Promise.resolve({ address: '8.8.8.8', family: 4 })),
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
  it('counts a multi-pass job once without rate-limiting its child map steps', async () => {
    settings.set('aiEnabled', '1');
    settings.set(
      'aiProviderConfig',
      JSON.stringify({
        engine: 'bundled',
        model: '',
        baseUrl: '',
        localModelId: 'llama3.2-1b-instruct-q4',
      }),
    );
    const verify = vi.spyOn(AiModelPackManager.prototype, 'verify').mockResolvedValue(true);
    try {
      for (let index = 0; index < 181; index++) {
        expect(
          await handler('ai:summarize')(
            {},
            { ...request, requestId: `pass-${index}`, jobId: 'one-job', mode: 'map' },
          ),
        ).toMatchObject({ ok: true });
      }
      for (let index = 0; index < 119; index++)
        expect(
          await handler('ai:summarize')(
            {},
            { ...request, requestId: `new-${index}`, jobId: `new-job-${index}`, mode: 'map' },
          ),
        ).toMatchObject({ ok: true });
      await expect(
        handler('ai:summarize')(
          {},
          { ...request, requestId: 'too-many', jobId: 'too-many', mode: 'map' },
        ),
      ).rejects.toThrow();
    } finally {
      verify.mockRestore();
    }
  });
  it.each(['linux', 'darwin', 'win32'])('keeps disabled operations inert on %s', async () => {
    expect(await handler('ai:getStatus')({})).toMatchObject({ enabled: false, engine: null });
    expect(await handler('ai:summarize')({}, request)).toEqual({ ok: false, reason: 'disabled' });
    expect(await handler('ai:listLocalModels')({})).toEqual([]);
    expect(await handler('ai:installLocalModel')({}, 'llama3.2-1b-instruct-q4')).toEqual({
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
  it('distinguishes ready endpoint configuration from a missing model', async () => {
    await handler('ai:setEnabled')({}, true);
    await handler('ai:setConfig')(
      {},
      { engine: 'local', wireFormat: 'openai', baseUrl: 'http://127.0.0.1:1234', model: 'test' },
    );
    vi.mocked(net.fetch).mockResolvedValue(new Response('{"data":[{"id":"test"}]}'));
    expect(await handler('ai:testConfig')({})).toEqual({ ok: true });
    await handler('ai:setConfig')(
      {},
      { engine: 'local', wireFormat: 'openai', baseUrl: 'http://127.0.0.1:1234', model: '' },
    );
    expect(await handler('ai:testConfig')({})).toEqual({ ok: false, reason: 'notConfigured' });
  });
  it('reports bundled readiness without a failure reason on success', async () => {
    settings.set('aiEnabled', '1');
    settings.set(
      'aiProviderConfig',
      JSON.stringify({
        engine: 'bundled',
        model: '',
        baseUrl: '',
        localModelId: 'llama3.2-1b-instruct-q4',
      }),
    );
    const verify = vi.spyOn(AiModelPackManager.prototype, 'verify').mockResolvedValue(true);
    try {
      expect(await handler('ai:testConfig')({})).toEqual({ ok: true });
      verify.mockResolvedValue(false);
      expect(await handler('ai:testConfig')({})).toEqual({ ok: false, reason: 'engineNotReady' });
    } finally {
      verify.mockRestore();
    }
  });
  it('cancels stalled model verification and accepts a retry before it resolves', async () => {
    settings.set('aiEnabled', '1');
    settings.set(
      'aiProviderConfig',
      JSON.stringify({
        engine: 'bundled',
        model: '',
        baseUrl: '',
        localModelId: 'llama3.2-1b-instruct-q4',
      }),
    );
    let finish!: (value: boolean) => void;
    const verify = vi
      .spyOn(AiModelPackManager.prototype, 'verify')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValue(true);
    try {
      const pending = handler('ai:summarize')({}, request);
      await vi.waitFor(() => {
        expect(verify).toHaveBeenCalledOnce();
      });
      await handler('ai:cancel')({}, request.requestId);
      expect(await pending).toEqual({ ok: false, reason: 'cancelled' });
      const retry = await handler('ai:summarize')(
        {},
        {
          ...request,
          requestId: 'retry',
          messages: Array.from({ length: 98 }, (_, at) => ({
            at,
            sender: 'Alice',
            body: 'Dense message '.repeat(8),
          })),
        },
      );
      expect(retry).toMatchObject({ ok: true, localJob: { truncated: true } });
      const prompt = (retry as { localJob: { system: string; user: string } }).localJob;
      expect(Buffer.byteLength(prompt.system + prompt.user)).toBeLessThanOrEqual(3500);
      finish(true);
      await Promise.resolve();
    } finally {
      verify.mockRestore();
    }
  });
  it.each(['removed-model', 'qwen2.5-0.5b-instruct-q4', 'smollm2-1.7b-instruct-q4'])(
    'reports removed model %s as not ready without verifying an unknown pack',
    async (localModelId) => {
      settings.set('aiEnabled', '1');
      settings.set(
        'aiProviderConfig',
        JSON.stringify({
          engine: 'bundled',
          model: '',
          baseUrl: '',
          localModelId,
        }),
      );
      const verify = vi.spyOn(AiModelPackManager.prototype, 'verify');
      try {
        expect(await handler('ai:testConfig')({})).toEqual({ ok: false, reason: 'engineNotReady' });
        expect(verify).not.toHaveBeenCalled();
        expect(await handler('ai:summarize')({}, request)).toEqual({
          ok: false,
          reason: 'engineNotReady',
        });
        expect(await handler('ai:getStatus')({})).toMatchObject({
          localEngine: { ready: false, modelId: null },
        });
        expect(await fs.readdir(fixture.directory)).toEqual([]);
      } finally {
        verify.mockRestore();
      }
    },
  );
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
    expect(await handler('ai:summarize')({}, request)).toEqual({
      ok: true,
      summaryInput: { messageCount: 1, truncated: false },
    });
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

it.each(['linux', 'darwin', 'win32'])(
  'keeps endpoint streaming alive beyond the old minute on %s',
  async () => {
    vi.useFakeTimers();
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort(new DOMException('Timed out', 'TimeoutError'));
      }, ms);
      return controller.signal;
    });
    try {
      await handler('ai:setEnabled')({}, true);
      expect(
        await handler('ai:setConfig')(
          {},
          {
            engine: 'local',
            wireFormat: 'openai',
            model: 'test',
            baseUrl: 'http://127.0.0.1:1234',
            timeoutSeconds: 90,
          },
        ),
      ).toMatchObject({ timeoutSeconds: 90 });
      let finish!: () => void;
      vi.mocked(net.fetch).mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              finish = () => {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"choices":[{"delta":{"content":"summary"}}]}\n\ndata: [DONE]\n\n',
                  ),
                );
                controller.close();
              };
            },
          }),
        ),
      );
      expect(await handler('ai:summarize')({}, request)).toMatchObject({ ok: true });
      await vi.advanceTimersByTimeAsync(60001);
      expect(send.mock.calls.filter(([channel]) => channel === 'ai:summaryError')).toHaveLength(0);
      finish();
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledWith(
        'ai:summaryDone',
        expect.objectContaining({ text: 'summary' }),
      );
      expect(deadline).toHaveBeenCalledWith(90000);
    } finally {
      deadline.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  },
);
