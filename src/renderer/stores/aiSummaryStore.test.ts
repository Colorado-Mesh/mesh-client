// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RepetitiveAiOutputError } from '@/renderer/lib/aiSummaryOutput';
import { AiWorkerHost } from '@/renderer/lib/aiWorkerHost';
import { APP_SETTINGS_STORAGE_KEY } from '@/renderer/lib/appSettingsStorage';
import type {
  AiAPI,
  AiProviderStatus,
  AiSummaryChunk,
  AiSummaryDone,
  AiSummaryError,
} from '@/shared/ai-types';

import {
  cancelSummary,
  dismissSummary,
  disposeAiSummaries,
  initializeAi,
  refreshAiStatus,
  runSummary,
  useAiSummaryStore,
} from './aiSummaryStore';

const ready: AiProviderStatus = {
  enabled: true,
  engine: 'remote',
  wireFormat: 'openai',
  baseUrl: 'https://provider.test',
  model: 'test',
  hasApiKey: true,
  timeoutSeconds: 60,
  allowRemote: true,
  isRemote: true,
  localEngine: { ready: false, modelId: null, downloading: false },
  osAi: { available: false, platform: null },
};
let chunk: (value: AiSummaryChunk) => void;
let done: (value: AiSummaryDone) => void;
let error: (value: AiSummaryError) => void;
let api: AiAPI;
const request = {
  requestId: 'id',
  conversationLabel: 'chat',
  protocol: 'meshcore' as const,
  surface: 'channel' as const,
  locale: 'en',
  scope: { kind: 'unread' as const },
  messages: [{ at: 1, sender: 'Alice', body: 'hello' }],
};
beforeEach(() => {
  disposeAiSummaries();
  api = {
    getStatus: vi.fn().mockResolvedValue(ready),
    summarize: vi.fn().mockResolvedValue({ ok: true }),
    cancel: vi.fn().mockResolvedValue(undefined),
    onSummaryChunk: vi.fn((cb) => {
      chunk = cb;
      return () => {};
    }),
    onSummaryDone: vi.fn((cb) => {
      done = cb;
      return () => {};
    }),
    onSummaryError: vi.fn((cb) => {
      error = cb;
      return () => {};
    }),
    onStatusChanged: vi.fn(() => () => {}),
  } as unknown as AiAPI;
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { ai: api } });
  useAiSummaryStore.getState().setStatus(ready);
});
afterEach(() => {
  disposeAiSummaries();
  vi.restoreAllMocks();
});
describe('AI summary request correlation', () => {
  it('reports oversized collected input without inference when no complete message fits', async () => {
    await runSummary('chat', { ...request, messages: [] }, true, 1);
    expect(api.summarize).not.toHaveBeenCalled();
    expect(useAiSummaryStore.getState().summaries.chat).toMatchObject({
      collectedMessageCount: 1,
      messageCount: 0,
      truncated: true,
      error: 'tooLarge',
      streaming: false,
    });
  });

  it('does not call offered messages included until main confirms prompt coverage', async () => {
    let acknowledge!: (value: {
      ok: boolean;
      summaryInput: { messageCount: number; truncated: boolean };
    }) => void;
    vi.mocked(api.summarize).mockReturnValueOnce(
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
    );
    const pending = runSummary('chat', request, false, 44);
    expect(useAiSummaryStore.getState().summaries.chat).toMatchObject({
      messageCount: null,
      collectedMessageCount: 44,
    });
    acknowledge({ ok: true, summaryInput: { messageCount: 1, truncated: true } });
    await pending;
    expect(useAiSummaryStore.getState().summaries.chat).toMatchObject({
      messageCount: 1,
      collectedMessageCount: 44,
      truncated: true,
    });
  });

  it('clears rejected bundled output, reports repetition and permits a manual retry', async () => {
    useAiSummaryStore.getState().setStatus({
      ...ready,
      engine: 'bundled',
      localEngine: { ready: true, modelId: 'test', downloading: false },
    });
    vi.mocked(api.summarize).mockResolvedValue({
      ok: true,
      localJob: {
        modelUrl: 'mesh-ai://test/model.gguf',
        system: 'system',
        user: 'fixture',
        model: 'test',
        messageCount: 1,
        truncated: false,
      },
    });
    vi.spyOn(AiWorkerHost.prototype, 'generate')
      .mockImplementationOnce((_job, _signal, delta) => {
        delta('Partial text');
        return Promise.reject(new RepetitiveAiOutputError());
      })
      .mockImplementationOnce((_job, _signal, delta) => {
        delta('East repeater is working.');
        return Promise.resolve();
      });
    await runSummary('chat', request);
    expect(useAiSummaryStore.getState().summaries.chat).toMatchObject({
      text: '',
      streaming: false,
      error: 'repetitiveOutput',
    });
    await runSummary('chat', { ...request, requestId: 'retry' });
    expect(useAiSummaryStore.getState().summaries.chat).toMatchObject({
      text: 'East repeater is working.',
      streaming: false,
    });
    expect(useAiSummaryStore.getState().summaries.chat?.error).toBeUndefined();
  });

  it('shows an empty range without probing or starting inference', async () => {
    await runSummary('chat', { ...request, messages: [] });
    expect(api.summarize).not.toHaveBeenCalled();
    expect(useAiSummaryStore.getState().summaries.chat).toMatchObject({
      messageCount: 0,
      streaming: false,
      error: 'noMessages',
    });
  });
  it('single-flights each conversation, accumulates chunks and preserves history truncation', async () => {
    await runSummary('chat', request, true);
    await runSummary('chat', { ...request, requestId: 'other' });
    expect(api.summarize).toHaveBeenCalledOnce();
    chunk({ requestId: 'id', delta: 'a' });
    chunk({ requestId: 'id', delta: 'b' });
    done({
      requestId: 'id',
      text: 'ab',
      provider: 'provider.test',
      model: 'test',
      messageCount: 1,
      truncated: false,
    });
    expect(useAiSummaryStore.getState().summaries.chat).toMatchObject({
      text: 'ab',
      streaming: false,
      truncated: true,
      disclosure: 'provider.test',
    });
  });
  it('ignores late chunks and completion after cancel/dismiss and isolates errors by id', async () => {
    await runSummary('one', request);
    cancelSummary('one');
    chunk({ requestId: 'id', delta: 'late' });
    done({
      requestId: 'id',
      text: 'late',
      provider: 'p',
      model: 'm',
      messageCount: 1,
      truncated: false,
    });
    expect(useAiSummaryStore.getState().summaries.one?.text).toBe('');
    dismissSummary('one');
    error({ requestId: 'id', reason: 'httpError' });
    expect(useAiSummaryStore.getState().summaries).toEqual({});
  });
  it('times out before a stalled main acknowledgement and ignores its late result', async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    let acknowledge!: (value: { ok: boolean }) => void;
    vi.mocked(api.summarize).mockReturnValueOnce(
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
    );
    const pending = runSummary('chat', request);
    timeout.abort(new DOMException('Timed out', 'TimeoutError'));
    await pending;
    acknowledge({ ok: true });
    await Promise.resolve();
    expect(api.cancel).toHaveBeenCalledWith('id');
    expect(useAiSummaryStore.getState().summaries.chat).toMatchObject({
      streaming: false,
      error: 'timeout',
    });
  });
  it('cancels a stalled acknowledgement immediately and accepts a new request', async () => {
    let acknowledge!: (value: { ok: boolean }) => void;
    vi.mocked(api.summarize).mockReturnValueOnce(
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
    );
    const pending = runSummary('chat', request);
    cancelSummary('chat');
    await pending;
    await runSummary('chat', { ...request, requestId: 'retry' });
    acknowledge({ ok: true });
    await Promise.resolve();
    expect(useAiSummaryStore.getState().summaries.chat).toMatchObject({
      requestId: 'retry',
      streaming: true,
    });
  });
  it('clears summaries when disabled or reconfigured and rejects stale status refreshes', async () => {
    await runSummary('chat', request);
    let resolve!: (status: AiProviderStatus) => void;
    vi.mocked(api.getStatus).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const pending = refreshAiStatus();
    useAiSummaryStore.getState().setStatus({ ...ready, enabled: false });
    resolve(ready);
    await pending;
    expect(useAiSummaryStore.getState().status?.enabled).toBe(false);
    expect(useAiSummaryStore.getState().summaries).toEqual({});
    chunk({ requestId: 'id', delta: 'late' });
    expect(useAiSummaryStore.getState().summaries).toEqual({});
  });
});

it.each(['os', 'bundled', 'local', 'remote'] as const)(
  'uses the configured deadline while awaiting %s',
  async (engine) => {
    const controller = new AbortController();
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    useAiSummaryStore.setState({
      status: {
        ...ready,
        engine,
        timeoutSeconds: 720,
        localEngine: { ready: true, modelId: 'model', downloading: false },
      },
    });
    vi.mocked(api.summarize).mockReturnValue(new Promise(() => {}));
    const running = runSummary('chat', request);
    expect(deadline).toHaveBeenCalledWith(720000);
    controller.abort(new DOMException('Timed out', 'TimeoutError'));
    await running;
    expect(useAiSummaryStore.getState().summaries.chat?.error).toBe('timeout');
    expect(api.cancel).toHaveBeenCalledWith('id');
  },
);

describe('AI startup status recovery', () => {
  beforeEach(() => {
    useAiSummaryStore.setState({ status: null, cachedEnabled: false });
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    disposeAiSummaries();
    vi.useRealTimers();
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'keeps a saved opt-in discoverable while startup status stalls on %s',
    async () => {
      localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ aiEnabled: true }));
      vi.mocked(api.getStatus).mockReturnValue(new Promise(() => {}));
      initializeAi();
      expect(useAiSummaryStore.getState()).toMatchObject({ status: null, cachedEnabled: true });
      await vi.advanceTimersByTimeAsync(33000);
      expect(api.getStatus).toHaveBeenCalledTimes(3);
      expect(useAiSummaryStore.getState().status).toBeNull();
      expect(api.summarize).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      vi.mocked(api.getStatus).mockResolvedValue(ready);
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
      expect(useAiSummaryStore.getState().status).toEqual(ready);
    },
  );

  it.each([undefined, false, 'true', 1])('requires strict cached opt-in: %s', async (aiEnabled) => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ aiEnabled }));
    vi.mocked(api.getStatus).mockReturnValue(new Promise(() => {}));
    initializeAi();
    expect(useAiSummaryStore.getState().cachedEnabled).toBe(false);
    disposeAiSummaries();
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.getStatus).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers after a rejected status request and cancels queued retries on teardown', async () => {
    vi.mocked(api.getStatus).mockRejectedValueOnce(new Error('bridge unavailable'));
    initializeAi();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.getStatus).toHaveBeenCalledTimes(2);
    expect(useAiSummaryStore.getState().status).toEqual(ready);
    useAiSummaryStore.setState({ status: null });
    vi.mocked(api.getStatus).mockRejectedValue(new Error('bridge unavailable'));
    initializeAi();
    await vi.advanceTimersByTimeAsync(0);
    disposeAiSummaries();
    await vi.advanceTimersByTimeAsync(60000);
    window.dispatchEvent(new Event('focus'));
    expect(api.getStatus).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets overlapping settings refreshes finish while only the latest result wins', async () => {
    let release!: (status: AiProviderStatus) => void;
    vi.mocked(api.getStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const previous = refreshAiStatus();
    await refreshAiStatus();
    release({ ...ready, enabled: false });
    await previous;
    expect(useAiSummaryStore.getState().status).toEqual(ready);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a superseded startup response when its newer settings request failed', async () => {
    let release!: (status: AiProviderStatus) => void;
    vi.mocked(api.getStatus)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockRejectedValueOnce(new Error('settings status failed'));
    initializeAi();
    await expect(refreshAiStatus()).rejects.toThrow('settings status failed');
    release(ready);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.getStatus).toHaveBeenCalledTimes(3);
    expect(useAiSummaryStore.getState().status).toEqual(ready);
  });

  it('skips a queued retry once settings established authoritative status', async () => {
    vi.mocked(api.getStatus).mockRejectedValueOnce(new Error('startup status failed'));
    initializeAi();
    await vi.advanceTimersByTimeAsync(0);
    await refreshAiStatus();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.getStatus).toHaveBeenCalledTimes(2);
    expect(useAiSummaryStore.getState().status).toEqual(ready);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a timed-out result after a newer successful refresh', async () => {
    let release!: (status: AiProviderStatus) => void;
    vi.mocked(api.getStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    initializeAi();
    await vi.advanceTimersByTimeAsync(11000);
    expect(useAiSummaryStore.getState().status).toEqual(ready);
    release({ ...ready, enabled: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(useAiSummaryStore.getState().status).toEqual(ready);
  });

  it('ignores pending startup work after disable or teardown', async () => {
    let release!: (status: AiProviderStatus) => void;
    vi.mocked(api.getStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    initializeAi();
    useAiSummaryStore.getState().setStatus({ ...ready, enabled: false });
    release(ready);
    await vi.advanceTimersByTimeAsync(60000);
    expect(useAiSummaryStore.getState().status?.enabled).toBe(false);
    expect(api.getStatus).toHaveBeenCalledOnce();
    useAiSummaryStore.setState({ status: null });
    vi.mocked(api.getStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    initializeAi();
    disposeAiSummaries();
    release(ready);
    await vi.advanceTimersByTimeAsync(0);
    expect(useAiSummaryStore.getState().status).toBeNull();
  });
});
