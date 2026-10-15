/* eslint-disable @typescript-eslint/require-await -- deterministic async fetch/runtime test doubles */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiWorkerHost } from './aiWorkerHost';

const fixture = vi.hoisted(() => ({
  load: vi.fn(),
  exit: vi.fn(),
  completion: vi.fn(),
  compat: vi.fn(),
}));
vi.mock('@wllama/wllama/esm/index', () => ({
  Wllama: class {
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
const job = {
  modelUrl: 'mesh-ai://model/model.gguf',
  system: 'summary',
  user: 'transcript',
  messageCount: 1,
  truncated: false,
  model: 'model',
};
describe('bundled AI worker lifecycle', () => {
  it('stays inert until explicit generate and streams with bundled assets and no CDN fallback', async () => {
    fixture.load.mockResolvedValue(undefined);
    fixture.exit.mockResolvedValue(undefined);
    fixture.completion.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'summary' } }] };
      })(),
    );
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('model'));
    vi.stubGlobal('fetch', fetchImpl);
    const host = new AiWorkerHost();
    expect(fetchImpl).not.toHaveBeenCalled();
    const delta = vi.fn();
    await host.generate(job, new AbortController().signal, delta);
    expect(delta).toHaveBeenCalledWith('summary');
    expect(fixture.compat).toHaveBeenCalledWith(null);
    expect(fixture.load).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ n_threads: 1, n_gpu_layers: 0 }),
    );
    expect(fixture.exit).toHaveBeenCalledTimes(1);
  });
  it('terminates promptly when cancelled during an unresolved model load and can reload', async () => {
    fixture.exit.mockResolvedValue(undefined);
    fixture.load.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(undefined);
    fixture.completion.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'new' } }] };
      })(),
    );
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
  it('cancels an iterator stalled between tokens', async () => {
    fixture.exit.mockResolvedValue(undefined);
    fixture.load.mockResolvedValue(undefined);
    fixture.completion.mockResolvedValue({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    });
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
