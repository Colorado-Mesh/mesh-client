import { create } from 'zustand';

import {
  type MultiPassProgress,
  runMultiPassSummary,
  shouldUseMultiPass,
} from '@/renderer/lib/aiMultiPassSummary';
import { RepetitiveAiOutputError } from '@/renderer/lib/aiSummaryOutput';
import type { AiWorkerPhase } from '@/renderer/lib/aiWorkerHost';
import { getAppSettingsRaw, mergeAppSettingsPartial } from '@/renderer/lib/appSettingsStorage';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import type {
  AiActionResult,
  AiProviderStatus,
  AiSummaryErrorReason,
  AiSummaryRequest,
  AiSummaryScope,
} from '@/shared/ai-types';
import { AI_MAX_RESPONSE_BYTES, aiSummaryTimeoutMs } from '@/shared/ai-types';
import { MS_PER_SECOND } from '@/shared/timeConstants';

/** UI status while a summary is pending; `queued` is renderer-only (FIFO wait). */
export type AiSummaryPhase = AiWorkerPhase | 'queued' | 'chunking' | 'merging';

export interface ConversationSummary {
  requestId: string;
  text: string;
  streaming: boolean;
  phase?: AiSummaryPhase;
  progress?: MultiPassProgress | null;
  provider: string;
  model: string;
  messageCount: number | null;
  collectedMessageCount: number;
  truncated: boolean;
  /** True when collection stopped at the user maxCollectedMessages ceiling. */
  ceilingTruncated?: boolean;
  error?: AiSummaryErrorReason;
  disclosure: string;
}
interface AiState {
  status: AiProviderStatus | null;
  /** Saved opt-in exposes setup only while authoritative status is unavailable. */
  cachedEnabled: boolean;
  summaries: Partial<Record<string, ConversationSummary>>;
  scopes: Partial<Record<string, AiSummaryScope>>;
  setScope: (key: string, scope: AiSummaryScope) => void;
  setStatus: (status: AiProviderStatus) => void;
}
const controllers = new Map<string, AbortController>();
let queueTail: Promise<void> | undefined;
let revision = 0;
let unsubscribe: (() => void) | undefined;
const statusRequests = new Set<AbortController>();
let statusSequence = 0;
let stopInitialization: (() => void) | undefined;
/** Maps in-flight pass requestIds to conversation keys (multi-pass child IDs). */
const passOwners = new Map<string, string>();
interface RemoteWaiter {
  resolve: (value: { text: string; messageCount: number }) => void;
  reject: (reason?: unknown) => void;
  silent: boolean;
}
/** Remote pass waiters (silent map/reduce or streaming final). */
const remoteWaiters = new Map<string, RemoteWaiter>();
export function getAiSummaryRevision(): number {
  return revision;
}
export const useAiSummaryStore = create<AiState>((set) => ({
  status: null,
  cachedEnabled: false,
  summaries: {},
  scopes: {},
  setScope: (key, scope) => {
    set((state) => ({
      scopes: { ...Object.fromEntries(Object.entries(state.scopes).slice(-49)), [key]: scope },
    }));
  },
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
    passOwners.get(id) ??
    Object.keys(useAiSummaryStore.getState().summaries).find(
      (key) => useAiSummaryStore.getState().summaries[key]?.requestId === id,
    );
  const unsubs = [
    api.onSummaryChunk((value) => {
      const waiter = remoteWaiters.get(value.requestId);
      if (waiter?.silent) return;
      const key = keyFor(value.requestId);
      if (key) {
        const current = useAiSummaryStore.getState().summaries[key];
        if (current?.streaming) patch(key, current.requestId, { text: current.text + value.delta });
      }
    }),
    api.onSummaryDone((value) => {
      const ownerKey = passOwners.get(value.requestId);
      const waiter = remoteWaiters.get(value.requestId);
      if (waiter) {
        remoteWaiters.delete(value.requestId);
        if (!waiter.silent && ownerKey) {
          const currentId = useAiSummaryStore.getState().summaries[ownerKey]?.requestId;
          if (currentId)
            patch(ownerKey, currentId, {
              text: value.text,
              provider: value.provider,
              model: value.model,
              truncated:
                useAiSummaryStore.getState().summaries[ownerKey]?.truncated === true ||
                value.truncated,
              progress: null,
              phase: undefined,
            });
        }
        passOwners.delete(value.requestId);
        waiter.resolve({ text: value.text, messageCount: value.messageCount });
        return;
      }
      const key = keyFor(value.requestId);
      if (key && useAiSummaryStore.getState().summaries[key]?.streaming) {
        const currentId = useAiSummaryStore.getState().summaries[key]!.requestId;
        patch(key, currentId, {
          text: value.text,
          provider: value.provider,
          model: value.model,
          messageCount: value.messageCount,
          truncated:
            useAiSummaryStore.getState().summaries[key]?.truncated === true || value.truncated,
          streaming: false,
          progress: null,
          phase: undefined,
        });
      }
      passOwners.delete(value.requestId);
    }),
    api.onSummaryError((value) => {
      const waiter = remoteWaiters.get(value.requestId);
      if (waiter) {
        remoteWaiters.delete(value.requestId);
        passOwners.delete(value.requestId);
        waiter.reject(new Error(value.reason));
        return;
      }
      const key = keyFor(value.requestId);
      if (key) {
        const currentId = useAiSummaryStore.getState().summaries[key]!.requestId;
        patch(key, currentId, { error: value.reason, streaming: false, progress: null });
      }
      passOwners.delete(value.requestId);
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

function waitForRemotePassDone(
  requestId: string,
  conversationKey: string,
  silent: boolean,
): Promise<{ text: string; messageCount: number }> {
  passOwners.set(requestId, conversationKey);
  return new Promise((resolve, reject) => {
    remoteWaiters.set(requestId, { resolve, reject, silent });
  });
}

function cancelRemoteWaiter(requestId: string): void {
  const waiter = remoteWaiters.get(requestId);
  if (!waiter) return;
  remoteWaiters.delete(requestId);
  passOwners.delete(requestId);
  waiter.reject(new DOMException('AI generation cancelled', 'AbortError'));
}
export async function refreshAiStatus(): Promise<void> {
  const controller = new AbortController();
  statusRequests.add(controller);
  const sequence = ++statusSequence;
  const before = revision;
  const timer = setTimeout(() => {
    controller.abort(new Error('AI status request timed out'));
  }, 10 * MS_PER_SECOND);
  let onAbort: () => void = () => {};
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        const reason: unknown = controller.signal.reason;
        reject(
          reason instanceof Error ? reason : new DOMException('AI status cancelled', 'AbortError'),
        );
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const status = await Promise.race([window.electronAPI.ai.getStatus(), aborted]);
    if (before !== revision || sequence !== statusSequence) return;
    useAiSummaryStore.setState({ status });
    if (status.enabled) subscribeAiEvents();
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
    statusRequests.delete(controller);
  }
}
export function initializeAi(): void {
  stopInitialization?.();
  try {
    const cached = parseStoredJson<{ aiEnabled?: unknown }>(getAppSettingsRaw(), 'AI settings');
    useAiSummaryStore.setState({ cachedEnabled: cached?.aiEnabled === true });
  } catch {
    // catch-no-log-ok unavailable preferences cannot establish opt-in
    useAiSummaryStore.setState({ cachedEnabled: false });
  }
  const before = revision;
  let stopped = false;
  let attempts = 0;
  let inFlight = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const attempt = () => {
    if (
      stopped ||
      inFlight ||
      before !== revision ||
      (attempts > 0 && useAiSummaryStore.getState().status !== null)
    )
      return;
    clearTimeout(retry);
    inFlight = true;
    attempts++;
    void refreshAiStatus()
      .catch((error: unknown) => {
        if (
          stopped ||
          before !== revision ||
          useAiSummaryStore.getState().status !== null ||
          (error instanceof DOMException && error.name === 'AbortError')
        )
          return;
        console.warn('[ai] Startup status unavailable; setup remains available for saved opt-in.');
      })
      .finally(() => {
        inFlight = false;
        if (
          !stopped &&
          before === revision &&
          useAiSummaryStore.getState().status === null &&
          attempts < 3
        )
          retry = setTimeout(attempt, attempts * MS_PER_SECOND);
      });
  };
  const onFocus = () => {
    if (useAiSummaryStore.getState().status !== null || inFlight) return;
    attempts = 0;
    attempt();
  };
  window.addEventListener('focus', onFocus);
  stopInitialization = () => {
    stopped = true;
    clearTimeout(retry);
    window.removeEventListener('focus', onFocus);
    for (const request of statusRequests) request.abort();
    stopInitialization = undefined;
  };
  attempt();
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
  ceilingTruncated = false,
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
    truncated: historyTruncated || ceilingTruncated,
    ceilingTruncated,
    disclosure,
  };
  useAiSummaryStore.setState((state) => ({
    summaries: {
      ...Object.fromEntries(
        Object.entries(state.summaries)
          .filter(([, value]) => value?.streaming)
          .concat(
            Object.entries(state.summaries)
              .filter(([, value]) => !value?.streaming)
              .slice(-49),
          ),
      ),
      [key]: entry,
    },
  }));
  if (!request.messages.length) {
    patch(key, id, {
      streaming: false,
      error: collectedMessageCount > 0 ? 'tooLarge' : 'noMessages',
    });
    return;
  }
  const controller = new AbortController();
  controllers.set(key, controller);
  const previous = queueTail;
  let release!: () => void;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous ? previous.then(() => finished) : finished;
  queueTail = tail;
  void tail.then(() => {
    if (queueTail === tail) queueTail = undefined;
  });
  if (previous) patch(key, id, { phase: 'queued' });
  let signal = controller.signal;
  let stopWatching: (() => void) | undefined;
  const activePassIds = new Set<string>();
  const abortReason = () =>
    signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? ('timeout' as const)
      : ('cancelled' as const);
  const onAbort = () => {
    patch(key, id, { streaming: false, error: abortReason(), progress: null });
    for (const passId of activePassIds) {
      void window.electronAPI.ai.cancel(passId).catch(() => {
        // catch-no-log-ok local state already reflects cancellation
      });
    }
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
    if (previous) await Promise.race([previous, aborted]);
    signal.throwIfAborted();
    if (before !== revision || useAiSummaryStore.getState().summaries[key]?.requestId !== id)
      return;
    patch(key, id, { phase: undefined });
    signal.removeEventListener('abort', onAbort);
    signal.removeEventListener('abort', rejectAbort);
    signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(aiSummaryTimeoutMs(status.engine, status.timeoutSeconds)),
    ]);
    signal.addEventListener('abort', onAbort, { once: true });
    signal.addEventListener('abort', rejectAbort, { once: true });
    const engine = status.engine;
    if (!engine) {
      patch(key, id, { streaming: false, error: 'notConfigured' });
      return;
    }
    if (shouldUseMultiPass(request.messages, engine)) {
      const result = await runMultiPassSummary({
        base: {
          conversationLabel: request.conversationLabel,
          protocol: request.protocol,
          surface: request.surface,
          locale: request.locale,
          scope: request.scope,
        },
        messages: request.messages,
        status,
        signal,
        callbacks: {
          onProgress: (progress) => {
            patch(key, id, {
              progress,
              phase: progress?.kind === 'merge' ? 'merging' : 'chunking',
            });
          },
          onPhase: (phase) => {
            patch(key, id, { phase });
          },
          onFinalDelta: (delta) => {
            const current = useAiSummaryStore.getState().summaries[key];
            if (current?.streaming)
              patch(key, id, {
                text: (current.text || '') + delta,
                phase: undefined,
                progress: null,
              });
          },
          onFinalText: (text) => {
            patch(key, id, { text, phase: undefined, progress: null });
          },
          waitForSilentRemoteDone: (requestId) => {
            activePassIds.add(requestId);
            return waitForRemotePassDone(requestId, key, true).finally(() => {
              activePassIds.delete(requestId);
            });
          },
          waitForStreamingRemoteDone: (requestId) => {
            activePassIds.add(requestId);
            return waitForRemotePassDone(requestId, key, false).finally(() => {
              activePassIds.delete(requestId);
            });
          },
          cancelRemoteWaiter: (requestId) => {
            activePassIds.delete(requestId);
            cancelRemoteWaiter(requestId);
          },
        },
      });
      signal.throwIfAborted();
      patch(key, id, {
        messageCount: result.messageCount,
        truncated: result.truncated || historyTruncated || ceilingTruncated,
        streaming: false,
        progress: null,
        phase: undefined,
        ...(!useAiSummaryStore.getState().summaries[key]?.text.trim()
          ? { error: 'invalidResponse' as const }
          : {}),
      });
      return;
    }

    const completed = new Promise<void>((resolve) => {
      const check = () => {
        const current = useAiSummaryStore.getState().summaries[key];
        if (current?.requestId !== id || !current.streaming) resolve();
      };
      stopWatching = useAiSummaryStore.subscribe(check);
      check();
    });
    const singleRequest = { ...request, mode: 'final' as const };
    activePassIds.add(id);
    const acknowledgement = window.electronAPI.ai.summarize(singleRequest);
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
        truncated: result.summaryInput.truncated || historyTruncated || ceilingTruncated,
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
        truncated: job.truncated || historyTruncated || ceilingTruncated,
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
    } else {
      passOwners.set(id, key);
      await Promise.race([completed, aborted]);
    }
  } catch (error) {
    // catch-no-log-ok never retain runtime error details containing conversation content
    if (before === revision)
      patch(key, id, {
        streaming: false,
        text: '',
        progress: null,
        error: signal.aborted
          ? abortReason()
          : error instanceof RepetitiveAiOutputError
            ? 'repetitiveOutput'
            : error instanceof Error &&
                [
                  'disabled',
                  'noMessages',
                  'notConfigured',
                  'engineNotReady',
                  'remoteNotAcknowledged',
                  'rateLimited',
                  'busy',
                  'timeout',
                  'tooLarge',
                  'httpError',
                  'invalidResponse',
                  'cancelled',
                ].includes(error.message)
              ? (error.message as AiSummaryErrorReason)
              : 'error',
      });
  } finally {
    signal.removeEventListener('abort', onAbort);
    signal.removeEventListener('abort', rejectAbort);
    controller.signal.removeEventListener('abort', onAbort);
    controller.signal.removeEventListener('abort', rejectAbort);
    stopWatching?.();
    for (const passId of activePassIds) passOwners.delete(passId);
    activePassIds.clear();
    if (controllers.get(key) === controller) controllers.delete(key);
    release();
  }
}

export function disposeAiSummaries(): void {
  stopInitialization?.();
  for (const request of statusRequests) request.abort();
  statusSequence++;
  revision++;
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  unsubscribe?.();
  useAiSummaryStore.setState({ summaries: {}, scopes: {} });
}
