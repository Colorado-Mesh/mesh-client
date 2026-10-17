/* eslint-disable @typescript-eslint/require-await -- deterministic async fetch/runtime test doubles */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepetitiveAiOutputError } from './aiSummaryOutput';
import { AiWorkerHost } from './aiWorkerHost';

const fixture = vi.hoisted(() => ({
  load: vi.fn(),
  exit: vi.fn(),
  completion: vi.fn(),
  compat: vi.fn(),
  logger: { error: () => {} },
}));
vi.mock('@wllama/wllama/esm/index', () => ({
  Wllama: class {
    constructor(_paths: unknown, options: { logger: { error: () => void } }) {
      fixture.logger = options.logger;
    }
    loadModel = fixture.load;
    exit = fixture.exit;
    createChatCompletion = fixture.completion;
    setCompat = fixture.compat;
  },
}));
vi.mock('@wllama/wllama/esm/wasm/wllama.wasm?url', () => ({ default: 'file:///bundled.wasm' }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
interface CompletionOptions {
  onData: (chunk: { choices: { delta: { content: string } }[] }) => void;
}
const complete = (text: string) => (options: CompletionOptions) => {
  options.onData({ choices: [{ delta: { content: text } }] });
  return Promise.resolve();
};
const job = {
  modelUrl: 'mesh-ai://model/model.gguf',
  system: 'summary',
  user: 'transcript',
  messageCount: 1,
  truncated: false,
  model: 'model',
};
describe('bundled AI worker lifecycle', () => {
  it('routes a retained runtime failure to the current pass and releases the model', async () => {
    fixture.load.mockResolvedValue(undefined);
    fixture.exit.mockResolvedValue(undefined);
    fixture.completion
      .mockImplementationOnce(complete('First digest.'))
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('model')),
    );
    const host = new AiWorkerHost();
    await host.generate(job, new AbortController().signal, vi.fn(), undefined, { keepAlive: true });
    const running = host.generate(job, new AbortController().signal, vi.fn(), undefined, {
      keepAlive: true,
    });
    const outcome = running.catch((error: unknown) => error);
    await vi.waitFor(() => {
      expect(fixture.completion).toHaveBeenCalledTimes(2);
    });
    fixture.logger.error();
    expect(await outcome).toMatchObject({ message: 'engineNotReady' });
    expect(fixture.load).toHaveBeenCalledOnce();
    expect(fixture.exit).toHaveBeenCalledOnce();
  });

  it('waits for an abort-triggered disposal before generation settles', async () => {
    fixture.load.mockResolvedValue(undefined);
    let finishDisposal!: () => void;
    fixture.exit.mockReturnValue(
      new Promise<void>((resolve) => {
        finishDisposal = resolve;
      }),
    );
    const controller = new AbortController();
    fixture.completion.mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('model')),
    );
    let settled = false;
    const outcome = new AiWorkerHost()
      .generate(job, controller.signal, vi.fn())
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    await vi.waitFor(() => {
      expect(fixture.exit).toHaveBeenCalledOnce();
    });
    expect(settled).toBe(false);
    finishDisposal();
    expect(await outcome).toMatchObject({ name: 'AbortError' });
  });
  it('stays inert until explicit generate and streams with bundled assets and no CDN fallback', async () => {
    fixture.load.mockResolvedValue(undefined);
    fixture.exit.mockResolvedValue(undefined);
    fixture.completion.mockImplementation(complete('summary'));
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('model'));
    vi.stubGlobal('fetch', fetchImpl);
    const host = new AiWorkerHost();
    expect(fetchImpl).not.toHaveBeenCalled();
    const delta = vi.fn();
    const phase = vi.fn();
    await host.generate(job, new AbortController().signal, delta, phase);
    expect(phase.mock.calls).toEqual([['loadingModel'], ['readingMessages']]);
    expect(delta).toHaveBeenCalledWith('summary');
    expect(fixture.compat).toHaveBeenCalledWith(null);
    expect(fixture.load).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        n_ctx: 4096,
        n_threads: 1,
        n_gpu_layers: 0,
        n_parallel: 1,
        n_batch: 128,
        n_ubatch: 128,
      }),
    );
    expect(fixture.completion).toHaveBeenCalledWith(
      expect.objectContaining({
        repeat_penalty: 1.1,
        repeat_last_n: 64,
        onData: expect.any(Function),
      }),
    );
    expect(fixture.exit).toHaveBeenCalledTimes(1);
  });
  it.each(['linux', 'darwin', 'win32'] as const)(
    'rejects looping chunks, preserves the failure through cleanup and can retry on %s',
    async (platform) => {
      vi.stubGlobal('window', { electronAPI: { getPlatform: () => platform } });
      fixture.load.mockResolvedValue(undefined);
      fixture.exit.mockRejectedValueOnce(new Error('teardown failed')).mockResolvedValue(undefined);
      const repeated = 'morning time, '.repeat(30);
      fixture.completion
        .mockImplementationOnce((options: CompletionOptions) => {
          for (let index = 0; index < repeated.length; index += 7) {
            options.onData({ choices: [{ delta: { content: repeated.slice(index, index + 7) } }] });
          }
          return Promise.resolve();
        })
        .mockImplementation(complete('K0FIX will inspect West at noon.'));
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(() => Promise.resolve(new Response('model'))),
      );
      const host = new AiWorkerHost();
      const delta = vi.fn();
      await expect(host.generate(job, new AbortController().signal, delta)).rejects.toBeInstanceOf(
        RepetitiveAiOutputError,
      );
      expect(delta.mock.calls.map(([value]) => value).join('')).not.toBe(repeated);
      expect(fixture.exit).toHaveBeenCalledOnce();
      await host.generate(job, new AbortController().signal, delta);
      expect(delta).toHaveBeenLastCalledWith('K0FIX will inspect West at noon.');
      expect(fixture.exit).toHaveBeenCalledTimes(2);
    },
  );

  it('settles a silenced upstream worker failure and can load another model', async () => {
    fixture.exit.mockResolvedValue(undefined);
    fixture.load.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(undefined);
    fixture.completion.mockImplementation(complete('retry summary'));
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('model')),
    );
    const host = new AiWorkerHost();
    const pending = host.generate(job, new AbortController().signal, vi.fn());
    const failure = expect(pending).rejects.toThrow('engineNotReady');
    await vi.waitFor(() => {
      expect(fixture.load).toHaveBeenCalled();
    });
    fixture.logger.error();
    await failure;
    expect(fixture.exit).toHaveBeenCalledOnce();
    const delta = vi.fn();
    await host.generate({ ...job, model: 'smaller model' }, new AbortController().signal, delta);
    expect(delta).toHaveBeenCalledWith('retry summary');
  });
  it('terminates promptly when cancelled during an unresolved model load and can reload', async () => {
    fixture.exit.mockResolvedValue(undefined);
    fixture.load.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(undefined);
    fixture.completion.mockImplementation(complete('new'));
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('model')),
    );
    const host = new AiWorkerHost();
    const controller = new AbortController();
    const running = host.generate(job, controller.signal, vi.fn());
    const rejection = expect(running).rejects.toThrow();
    await vi.waitFor(() => {
      expect(fixture.load).toHaveBeenCalled();
    });
    controller.abort();
    await rejection;
    expect(fixture.exit).toHaveBeenCalledTimes(1);
    await host.generate(job, new AbortController().signal, vi.fn());
    expect(fixture.load).toHaveBeenCalledTimes(2);
  });
  it('cancels a stalled callback stream', async () => {
    fixture.exit.mockResolvedValue(undefined);
    fixture.load.mockResolvedValue(undefined);
    fixture.completion.mockImplementation(() => new Promise<void>(() => {}));
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('model')),
    );
    const controller = new AbortController();
    const running = new AiWorkerHost().generate(job, controller.signal, vi.fn());
    const rejection = expect(running).rejects.toThrow();
    await vi.waitFor(() => {
      expect(fixture.completion).toHaveBeenCalled();
    });
    controller.abort();
    await rejection;
    expect(fixture.exit).toHaveBeenCalledOnce();
  });
});
