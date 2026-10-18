import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiAPI, AiProviderStatus, AiSummaryRequest } from '@/shared/ai-types';

import {
  type MultiPassCallbacks,
  runMultiPassSummary,
  shouldUseMultiPass,
} from './aiMultiPassSummary';

const worker = vi.hoisted(() => ({ generate: vi.fn(), dispose: vi.fn(), instances: 0 }));
vi.mock('./aiWorkerHost', () => ({
  AiWorkerHost: class {
    constructor() {
      worker.instances++;
    }
    generate = worker.generate;
    dispose = worker.dispose;
  },
}));

const base = {
  conversationLabel: 'Local chat',
  protocol: 'meshcore' as const,
  surface: 'channel' as const,
  locale: 'en',
  scope: { kind: 'unread' as const },
};
const status = { engine: 'os', timeoutSeconds: 60 } as AiProviderStatus;
const messages = Array.from({ length: 169 }, (_, at) => ({
  at,
  sender: 'Alice',
  body: `Message ${at}: radio plans and batteries.`,
}));
interface Done {
  text: string;
  messageCount: number;
}
let callbacks: MultiPassCallbacks;
let requests: AiSummaryRequest[];
let waiters: Map<string, { resolve: (value: Done) => void; reject: (error: Error) => void }>;
let api: Pick<AiAPI, 'summarize' | 'cancel'>;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => {
  worker.instances = 0;
  worker.generate
    .mockReset()
    .mockImplementation((_job, _signal, delta: (value: string) => void) => {
      delta('Useful digest.');
      return Promise.resolve();
    });
  worker.dispose.mockReset().mockResolvedValue(undefined);
  requests = [];
  waiters = new Map();
  const wait = (id: string) =>
    new Promise<Done>((resolve, reject) => {
      waiters.set(id, { resolve, reject });
    });
  callbacks = {
    onProgress: vi.fn(),
    onPhase: vi.fn(),
    onFinalDelta: vi.fn(),
    onFinalText: vi.fn(),
    waitForSilentRemoteDone: wait,
    waitForStreamingRemoteDone: wait,
    cancelRemoteWaiter: (id) => {
      waiters.get(id)?.reject(new DOMException('Cancelled', 'AbortError'));
      waiters.delete(id);
    },
  };
  api = {
    summarize: vi.fn((request: AiSummaryRequest) => {
      requests.push(request);
      waiters
        .get(request.requestId)
        ?.resolve({ text: 'Useful digest.', messageCount: request.messages.length });
      return Promise.resolve({
        ok: true,
        summaryInput: { messageCount: request.messages.length, truncated: false },
      });
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal('window', { electronAPI: { ai: api } });
});
describe('multi-pass summary orchestration', () => {
  it.each(['meshtastic', 'meshcore', 'reticulum'] as const)(
    'processes all 169 %s messages and merges them into a final summary',
    async (protocol) => {
      const result = await runMultiPassSummary({
        base: { ...base, protocol },
        messages,
        status,
        signal: new AbortController().signal,
        callbacks,
      });
      expect(
        requests.filter((request) => request.mode === 'map').flatMap((request) => request.messages),
      ).toEqual(messages);
      expect(requests.at(-1)?.mode).toBe('final');
      expect(result).toEqual({ messageCount: 169, truncated: false });
      expect(callbacks.onFinalText).toHaveBeenCalledExactlyOnceWith('Useful digest.');
      expect(waiters.size).toBe(0);
    },
  );
  it('splits an oversized source message and counts it once', async () => {
    const oversized = [{ at: 1, sender: 'Alice', body: '漢😀\n'.repeat(2000) }];
    expect(shouldUseMultiPass(oversized, 'os', base)).toBe(true);
    const result = await runMultiPassSummary({
      base,
      messages: oversized,
      status,
      signal: new AbortController().signal,
      callbacks,
    });
    expect(
      requests
        .filter((request) => request.mode === 'map')
        .flatMap((request) => request.messages)
        .map((message) => message.body)
        .join(''),
    ).toBe(oversized[0].body);
    expect(result.messageCount).toBe(1);
  });
  it('reuses a single bundled model across passes', async () => {
    vi.mocked(api.summarize).mockImplementation((request) => {
      requests.push(request);
      return Promise.resolve({
        ok: true,
        localJob: {
          system: 'summary',
          user: 'transcript',
          model: 'model',
          modelUrl: 'mesh-ai://model/model.gguf',
          messageCount: request.messages.length,
          truncated: false,
          maxTokens: request.mode === 'map' ? 96 : request.mode === 'reduce' ? 128 : 250,
        },
      });
    });
    const result = await runMultiPassSummary({
      base,
      messages,
      status: { ...status, engine: 'bundled' },
      signal: new AbortController().signal,
      callbacks,
    });
    expect(result.messageCount).toBe(169);
    expect(worker.instances).toBe(1);
    expect(worker.generate).toHaveBeenCalledTimes(requests.length);
    expect(worker.generate.mock.calls[0][4]).toEqual({ keepAlive: true });
    expect(worker.generate.mock.calls.at(-1)?.[4]).toEqual({ keepAlive: false });
    expect(waiters.size).toBe(0);
  });
  it('cancels a stalled acknowledgement and removes its waiter', async () => {
    vi.mocked(api.summarize).mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const running = runMultiPassSummary({
      base,
      messages,
      status,
      signal: controller.signal,
      callbacks,
    });
    const outcome = running.catch((error: unknown) => error);
    controller.abort();
    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(api.summarize).toHaveBeenCalledOnce();
    expect(api.cancel).toHaveBeenCalledOnce();
    expect(waiters.size).toBe(0);
  });

  it('times out a stalled acknowledgement and removes its waiter', async () => {
    vi.mocked(api.summarize).mockReturnValue(new Promise(() => {}));
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const running = runMultiPassSummary({
      base,
      messages,
      status,
      signal: new AbortController().signal,
      callbacks,
    });
    const outcome = running.catch((error: unknown) => error);
    deadline.abort(new DOMException('Timed out', 'TimeoutError'));
    expect(await outcome).toMatchObject({ name: 'TimeoutError' });
    expect(api.cancel).toHaveBeenCalledOnce();
    expect(waiters.size).toBe(0);
  });
  it('removes waiters when acknowledgement rejects or main reports partial coverage', async () => {
    vi.mocked(api.summarize).mockRejectedValueOnce(new Error('offline'));
    await expect(
      runMultiPassSummary({
        base,
        messages,
        status,
        signal: new AbortController().signal,
        callbacks,
      }),
    ).rejects.toThrow('offline');
    expect(waiters.size).toBe(0);
    vi.mocked(api.summarize).mockResolvedValueOnce({
      ok: true,
      summaryInput: { messageCount: 1, truncated: true },
    });
    await expect(
      runMultiPassSummary({
        base,
        messages,
        status,
        signal: new AbortController().signal,
        callbacks,
      }),
    ).rejects.toThrow('tooLarge');
    expect(waiters.size).toBe(0);
    expect(callbacks.onFinalText).not.toHaveBeenCalled();
  });
  it('bounds reduction when a provider repeatedly returns digests that cannot converge', async () => {
    vi.mocked(api.summarize).mockImplementation((request) => {
      requests.push(request);
      waiters
        .get(request.requestId)
        ?.resolve({ text: '漢'.repeat(1000), messageCount: request.messages.length });
      return Promise.resolve({
        ok: true,
        summaryInput: { messageCount: request.messages.length, truncated: false },
      });
    });
    await expect(
      runMultiPassSummary({
        base,
        messages: messages.slice(0, 40),
        status,
        signal: new AbortController().signal,
        callbacks,
      }),
    ).rejects.toThrow('invalidResponse');
    expect(callbacks.onFinalText).not.toHaveBeenCalled();
    expect(waiters.size).toBe(0);
  });
});
