import { create } from 'zustand';

import { RepetitiveAiOutputError } from '@/renderer/lib/aiSummaryOutput';
import type { AiWorkerPhase } from '@/renderer/lib/aiWorkerHost';
import { mergeAppSettingsPartial } from '@/renderer/lib/appSettingsStorage';
import type {
  AiActionResult,
  AiProviderStatus,
  AiSummaryErrorReason,
  AiSummaryRequest,
} from '@/shared/ai-types';
import { AI_MAX_RESPONSE_BYTES, aiSummaryTimeoutMs } from '@/shared/ai-types';

export interface ConversationSummary {
  requestId: string;
  text: string;
  streaming: boolean;
  phase?: AiWorkerPhase;
  provider: string;
  model: string;
  messageCount: number | null;
  collectedMessageCount: number;
  truncated: boolean;
  error?: AiSummaryErrorReason;
  disclosure: string;
}
interface AiState {
  status: AiProviderStatus | null;
  summaries: Partial<Record<string, ConversationSummary>>;
  setStatus: (status: AiProviderStatus) => void;
}
const controllers = new Map<string, AbortController>();
let bundledBusy = false;
let revision = 0;
let unsubscribe: (() => void) | undefined;
export function getAiSummaryRevision(): number {
  return revision;
}
export const useAiSummaryStore = create<AiState>((set) => ({
  status: null,
  summaries: {},
  setStatus: (status) => {
    revision++;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    if (!status.enabled) unsubscribe?.();
    set({ status, summaries: {} });
    mergeAppSettingsPartial({ aiEnabled: status.enabled }, 'AI settings');
  },
}));
function patch(key: string, id: string, update: Partial<ConversationSummary>) {
  useAiSummaryStore.setState((state) =>
    state.summaries[key]?.requestId === id
      ? { summaries: { ...state.summaries, [key]: { ...state.summaries[key], ...update } } }
      : {},
  );
}
export function subscribeAiEvents(): void {
  if (unsubscribe) return;
  const api = window.electronAPI.ai;
  const keyFor = (id: string) =>
    Object.keys(useAiSummaryStore.getState().summaries).find(
      (key) => useAiSummaryStore.getState().summaries[key]?.requestId === id,
    );
  const unsubs = [
    api.onSummaryChunk((value) => {
      const key = keyFor(value.requestId);
      if (key) {
        const current = useAiSummaryStore.getState().summaries[key];
        if (current?.streaming) patch(key, value.requestId, { text: current.text + value.delta });
      }
    }),
    api.onSummaryDone((value) => {
      const key = keyFor(value.requestId);
      if (key && useAiSummaryStore.getState().summaries[key]?.streaming)
        patch(key, value.requestId, {
          ...value,
          truncated:
            useAiSummaryStore.getState().summaries[key]?.truncated === true || value.truncated,
          streaming: false,
        });
    }),
    api.onSummaryError((value) => {
      const key = keyFor(value.requestId);
      if (key) patch(key, value.requestId, { error: value.reason, streaming: false });
    }),
    api.onStatusChanged((value) => {
      useAiSummaryStore.getState().setStatus(value);
    }),
  ];
  unsubscribe = () => {
    for (const unsub of unsubs) unsub();
    unsubscribe = undefined;
  };
}
export async function refreshAiStatus(): Promise<void> {
  const before = revision;
  const status = await window.electronAPI.ai.getStatus();
  if (before !== revision) return;
  useAiSummaryStore.setState({ status });
  if (status.enabled) subscribeAiEvents();
}
export function initializeAi(): void {
  void refreshAiStatus().catch(() => {
    // catch-no-log-ok unavailable bridge leaves AI hidden
  });
}
export function aiReady(status: AiProviderStatus | null): boolean {
  return (
    !!status?.enabled &&
    (status.engine === 'os'
      ? true
      : status.engine === 'bundled'
        ? status.localEngine.ready
        : (status.engine === 'local' || status.engine === 'remote') &&
          !!status.model &&
          !!status.baseUrl)
  );
}
export function cancelSummary(key: string): void {
  const entry = useAiSummaryStore.getState().summaries[key];
  if (!entry) return;
  controllers.get(key)?.abort();
  patch(key, entry.requestId, { streaming: false, error: 'cancelled' });
  void window.electronAPI.ai.cancel(entry.requestId).catch(() => {
    // catch-no-log-ok local cancellation already invalidated the result
  });
}
export function dismissSummary(key: string): void {
  cancelSummary(key);
  useAiSummaryStore.setState((state) => {
    const summaries = Object.fromEntries(
      Object.entries(state.summaries).filter(([entryKey]) => entryKey !== key),
    );
    return { summaries };
  });
}
export async function runSummary(
  key: string,
  request: AiSummaryRequest,
  historyTruncated = false,
  collectedMessageCount = request.messages.length,
): Promise<void> {
  if (useAiSummaryStore.getState().summaries[key]?.streaming) return;
  const status = useAiSummaryStore.getState().status;
  if (!aiReady(status) || !status) return;
  subscribeAiEvents();
  const before = revision;
  const id = request.requestId;
  let disclosure = '';
  if (status.engine === 'local' || status.engine === 'remote')
    disclosure = new URL(status.baseUrl).host;
  const entry: ConversationSummary = {
    requestId: id,
    text: '',
    streaming: true,
    provider: status.engine ?? '',
    model: status.model,
    messageCount: request.messages.length ? null : 0,
    collectedMessageCount,
    truncated: historyTruncated,
    disclosure,
  };
  useAiSummaryStore.setState((state) => ({
    summaries: { ...Object.fromEntries(Object.entries(state.summaries).slice(-49)), [key]: entry },
  }));
  if (!request.messages.length) {
    patch(key, id, {
      streaming: false,
      error: collectedMessageCount > 0 ? 'tooLarge' : 'noMessages',
    });
    return;
  }
  const ownsBundled = status.engine === 'bundled';
  if (ownsBundled && bundledBusy) {
    patch(key, id, { streaming: false, error: 'busy' });
    return;
  }
  if (ownsBundled) bundledBusy = true;
  const controller = new AbortController();
  controllers.set(key, controller);
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(aiSummaryTimeoutMs(status.engine, status.timeoutSeconds)),
  ]);
  const abortReason = () =>
    signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? ('timeout' as const)
      : ('cancelled' as const);
  const onAbort = () => {
    patch(key, id, { streaming: false, error: abortReason() });
    void window.electronAPI.ai.cancel(id).catch(() => {
      // catch-no-log-ok local state already reflects cancellation
    });
  };
  signal.addEventListener('abort', onAbort, { once: true });
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('AI generation cancelled', 'AbortError'),
      );
    };
    signal.addEventListener('abort', rejectAbort, { once: true });
    if (signal.aborted) rejectAbort();
  });
  try {
    const acknowledgement = window.electronAPI.ai.summarize(request);
    const result: AiActionResult = await Promise.race([acknowledgement, aborted]);
    if (before !== revision || signal.aborted) {
      if (before === revision) patch(key, id, { streaming: false, error: abortReason() });
      await window.electronAPI.ai.cancel(id);
      return;
    }
    if (!result.ok) {
      patch(key, id, { error: result.reason as AiSummaryErrorReason, streaming: false });
      return;
    }
    if (result.summaryInput) {
      patch(key, id, {
        messageCount: result.summaryInput.messageCount,
        truncated: result.summaryInput.truncated || historyTruncated,
      });
    }
    if (result.localJob) {
      const job = result.localJob;
      const { AiWorkerHost } = await Promise.race([import('@/renderer/lib/aiWorkerHost'), aborted]);
      signal.throwIfAborted();
      const host = new AiWorkerHost();
      let text = '';
      patch(key, id, {
        model: job.model,
        messageCount: job.messageCount,
        truncated: job.truncated || historyTruncated,
      });
      await host.generate(
        job,
        signal,
        (delta) => {
          text += delta;
          if (text.length > AI_MAX_RESPONSE_BYTES) throw new Error('tooLarge');
          patch(key, id, { text });
        },
        (phase) => {
          patch(key, id, { phase });
        },
      );
      signal.throwIfAborted();
      patch(key, id, {
        text,
        streaming: false,
        ...(!text.trim() ? { error: 'invalidResponse' as const } : {}),
      });
    }
  } catch (error) {
    // catch-no-log-ok never retain runtime error details containing conversation content
    if (before === revision)
      patch(key, id, {
        streaming: false,
        text: '',
        error: signal.aborted
          ? abortReason()
          : error instanceof RepetitiveAiOutputError
            ? 'repetitiveOutput'
            : 'error',
      });
  } finally {
    signal.removeEventListener('abort', onAbort);
    signal.removeEventListener('abort', rejectAbort);
    if (ownsBundled) bundledBusy = false;
    if (controllers.get(key) === controller) controllers.delete(key);
  }
}

export function disposeAiSummaries(): void {
  revision++;
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  unsubscribe?.();
  useAiSummaryStore.setState({ summaries: {} });
}
