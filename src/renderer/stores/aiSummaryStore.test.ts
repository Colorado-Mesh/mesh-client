// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  it('finishes a timed-out request whose main acknowledgement arrives late', async () => {
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
    acknowledge({ ok: true });
    await pending;
    expect(api.cancel).toHaveBeenCalledWith('id');
    expect(useAiSummaryStore.getState().summaries.chat).toMatchObject({
      streaming: false,
      error: 'timeout',
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
