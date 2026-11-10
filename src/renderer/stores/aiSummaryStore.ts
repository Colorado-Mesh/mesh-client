import { create } from 'zustand';

import { retainFollowUpMessages } from '@/renderer/lib/aiFollowUpContext';
import {
  type MultiPassProgress,
  runMultiPassSummary,
  shouldUseMultiPass,
} from '@/renderer/lib/aiMultiPassSummary';
import {
  finalizeAiSummaryText,
  RepetitiveAiOutputError,
  sanitizeAiModelOutput,
} from '@/renderer/lib/aiSummaryOutput';
import type { AiWorkerPhase } from '@/renderer/lib/aiWorkerHost';
import { getAppSettingsRaw, mergeAppSettingsPartial } from '@/renderer/lib/appSettingsStorage';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import type {
  AiActionResult,
  AiProviderStatus,
  AiSummaryErrorReason,
  AiSummaryMessage,
  AiSummaryRequest,
  AiSummaryScope,
} from '@/shared/ai-types';
import { AI_MAX_RESPONSE_BYTES, aiSummaryTimeoutMs } from '@/shared/ai-types';
import { MS_PER_SECOND } from '@/shared/timeConstants';

/** UI status while a summary is pending; `queued` is renderer-only (FIFO wait). */
export type AiSummaryPhase = AiWorkerPhase | 'queued' | 'chunking' | 'merging';

export interface AiFollowUpTurnState {
  id: string;
  question: string;
  answer: string;
  streaming: boolean;
  queued?: boolean;
  phase?: AiWorkerPhase;
  error?: AiSummaryErrorReason;
  truncated?: boolean;
}

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
  /** Base request fields retained so follow-ups do not need to re-plumb the hook. */
  followUpBase?: Pick<
    AiSummaryRequest,
    'conversationLabel' | 'protocol' | 'surface' | 'locale' | 'scope'
  >;
  /** Source context retained for follow-ups (session memory only). */
  followUpContext?: {
    messages?: AiSummaryMessage[];
    digests?: string[];
    limited: boolean;
  };
  /** Completed follow-up turns, oldest first. */
  followUps?: AiFollowUpTurnState[];
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
/** turn id -> abort controller for follow-up answers. */
const followUpControllers = new Map<string, AbortController>();
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
  onChunk?: (delta: string) => void;
}
/** Remote pass waiters (silent map/reduce or streaming final). */
const remoteWaiters = new Map<string, RemoteWaiter>();

function abortAllFollowUps(): void {
  for (const controller of followUpControllers.values())
    controller.abort(new DOMException('Follow-up cancelled', 'AbortError'));
  followUpControllers.clear();
}

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
    abortAllFollowUps();
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
function patchFollowUp(key: string, id: string, update: Partial<AiFollowUpTurnState>) {
  useAiSummaryStore.setState((state) => {
    const entry = state.summaries[key];
    if (!entry?.followUps?.some((turn) => turn.id === id)) return {};
    return {
      summaries: {
        ...state.summaries,
        [key]: {
          ...entry,
          followUps: entry.followUps.map((turn) =>
            turn.id === id ? { ...turn, ...update } : turn,
          ),
        },
      },
    };
  });
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
      if (waiter?.onChunk) {
        waiter.onChunk(value.delta);
        return;
      }
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
        // Ask / callback-driven streams sanitize only (dedupe is for Catch up).
        // Catch-up paths without onChunk finalize here; streaming Catch up finalizes in onFinalText.
        const cleaned = waiter.onChunk
          ? sanitizeAiModelOutput(value.text)
          : finalizeAiSummaryText(value.text);
        // Callback-driven streams (onChunk) own UI updates via onFinalText — do not
        // clobber ConversationSummary.text (follow-ups must never overwrite Catch up).
        if (!waiter.silent && !waiter.onChunk && ownerKey) {
          const currentId = useAiSummaryStore.getState().summaries[ownerKey]?.requestId;
          if (currentId)
            patch(ownerKey, currentId, {
              text: cleaned,
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
        waiter.resolve({
          text: cleaned,
          messageCount: value.messageCount,
        });
        return;
      }
      const key = keyFor(value.requestId);
      if (key && useAiSummaryStore.getState().summaries[key]?.streaming) {
        const currentId = useAiSummaryStore.getState().summaries[key]!.requestId;
        patch(key, currentId, {
          text: finalizeAiSummaryText(value.text),
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
  onChunk?: (delta: string) => void,
): Promise<{ text: string; messageCount: number }> {
  passOwners.set(requestId, conversationKey);
  return new Promise((resolve, reject) => {
    remoteWaiters.set(requestId, { resolve, reject, silent, onChunk });
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
  for (const turn of entry.followUps ?? []) {
    if (turn.streaming) cancelFollowUp(key, turn.id);
  }
  patch(key, entry.requestId, { streaming: false, error: 'cancelled' });
  void window.electronAPI.ai.cancel(entry.requestId).catch(() => {
    // catch-no-log-ok local cancellation already invalidated the result
  });
}
export function dismissSummary(key: string): void {
  const entry = useAiSummaryStore.getState().summaries[key];
  for (const turn of entry?.followUps ?? []) {
    if (turn.streaming) cancelFollowUp(key, turn.id);
  }
  cancelSummary(key);
  useAiSummaryStore.setState((state) => {
    const summaries = Object.fromEntries(
      Object.entries(state.summaries).filter(([entryKey]) => entryKey !== key),
    );
    return { summaries };
  });
}

/** Abort one follow-up turn without clearing the Catch up summary text. */
export function cancelFollowUp(key: string, id: string): void {
  const controller = followUpControllers.get(id);
  if (!controller) return;
  followUpControllers.delete(id);
  controller.abort(new DOMException('Follow-up cancelled', 'AbortError'));
  patchFollowUp(key, id, {
    streaming: false,
    queued: false,
    phase: undefined,
    error: 'cancelled',
  });
  void window.electronAPI.ai.cancel(id).catch(() => {
    // catch-no-log-ok local state already reflects cancellation
  });
}
/** Map thrown/abort failures to `AiSummaryErrorReason` without retaining conversation text. */
export function mapAiError(
  error: unknown,
  signal: AbortSignal,
  abortReason: () => AiSummaryErrorReason,
): AiSummaryErrorReason {
  if (signal.aborted) return abortReason();
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof RepetitiveAiOutputError) return 'repetitiveOutput';
  if (error instanceof Error) {
    const message = error.message;
    if (
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
      ].includes(message)
    )
      return message as AiSummaryErrorReason;
    const lower = message.toLowerCase();
    // wllama / llama-server when the tokenized prompt does not fit n_ctx
    if (
      (lower.includes('exceed') && lower.includes('context')) ||
      lower.includes('kv_cache_full') ||
      lower.includes('exceed_context_size')
    )
      return 'tooLarge';
  }
  return 'error';
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
  const existing = useAiSummaryStore.getState().summaries[key];
  for (const turn of existing?.followUps ?? []) {
    if (turn.streaming) cancelFollowUp(key, turn.id);
  }
  const before = revision;
  const id = request.requestId;
  let disclosure = '';
  if (status.engine === 'local' || status.engine === 'remote')
    disclosure = new URL(status.baseUrl).host;
  const followUpBase: ConversationSummary['followUpBase'] = {
    conversationLabel: request.conversationLabel,
    protocol: request.protocol,
    surface: request.surface,
    locale: request.locale,
    scope: request.scope,
  };
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
    followUpBase,
    followUps: [],
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
  void aborted.catch(() => {
    /* catch-no-log-ok multi-pass cancellation is awaited through each pass */
  });
  try {
    if (previous) await Promise.race([previous, aborted]);
    signal.throwIfAborted();
    if (before !== revision || useAiSummaryStore.getState().summaries[key]?.requestId !== id)
      return;
    patch(key, id, { phase: undefined });
    signal.removeEventListener('abort', onAbort);
    signal.removeEventListener('abort', rejectAbort);
    const multiPass = status.engine && shouldUseMultiPass(request.messages, status.engine, request);
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
    if (multiPass) {
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
            patch(key, id, {
              text: finalizeAiSummaryText(text),
              phase: undefined,
              progress: null,
            });
          },
          waitForSilentRemoteDone: (requestId) => {
            activePassIds.add(requestId);
            return waitForRemotePassDone(requestId, key, true).finally(() => {
              activePassIds.delete(requestId);
            });
          },
          waitForStreamingRemoteDone: (requestId, onChunk) => {
            activePassIds.add(requestId);
            return waitForRemotePassDone(requestId, key, false, onChunk).finally(() => {
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
      const retained = retainFollowUpMessages(request.messages);
      patch(key, id, {
        messageCount: result.messageCount,
        truncated: result.truncated || historyTruncated || ceilingTruncated || retained.clipped,
        streaming: false,
        progress: null,
        phase: undefined,
        followUpContext: {
          digests: result.digests,
          messages: retained.messages,
          limited: result.truncated || historyTruncated || ceilingTruncated || retained.clipped,
        },
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
    const retained = retainFollowUpMessages(request.messages);
    const followUpContextFromSinglePass = (
      promptTruncated: boolean,
    ): ConversationSummary['followUpContext'] => ({
      messages: retained.messages,
      limited: historyTruncated || ceilingTruncated || retained.clipped || promptTruncated,
    });
    // Attach capped context before streaming finishes so Ask never races an empty context.
    patch(key, id, {
      ...(result.summaryInput
        ? {
            messageCount: result.summaryInput.messageCount,
            truncated:
              result.summaryInput.truncated ||
              historyTruncated ||
              ceilingTruncated ||
              retained.clipped,
          }
        : {}),
      followUpContext: followUpContextFromSinglePass(false),
    });
    if (result.localJob) {
      const job = result.localJob;
      const { AiWorkerHost } = await Promise.race([import('@/renderer/lib/aiWorkerHost'), aborted]);
      signal.throwIfAborted();
      const host = new AiWorkerHost();
      let text = '';
      patch(key, id, {
        model: job.model,
        messageCount: job.messageCount,
        truncated: job.truncated || historyTruncated || ceilingTruncated || retained.clipped,
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
      const finalized = finalizeAiSummaryText(text);
      patch(key, id, {
        text: finalized,
        streaming: false,
        followUpContext: followUpContextFromSinglePass(job.truncated),
        ...(!finalized.trim() ? { error: 'invalidResponse' as const } : {}),
      });
    } else {
      passOwners.set(id, key);
      await Promise.race([completed, aborted]);
      const current = useAiSummaryStore.getState().summaries[key];
      if (current?.requestId === id && !current.error)
        patch(key, id, {
          followUpContext: followUpContextFromSinglePass(current.truncated),
        });
    }
  } catch (error) {
    // catch-no-log-ok never retain runtime error details containing conversation content
    if (before === revision)
      patch(key, id, {
        streaming: false,
        text: '',
        progress: null,
        error: mapAiError(error, signal, abortReason),
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

/** Queue a follow-up about a completed Catch up (lazy-loads the heavy runner). */
export async function askFollowUp(key: string, question: string): Promise<void> {
  const { runAskFollowUp } = await import('@/renderer/lib/aiFollowUpRunner');
  await runAskFollowUp(key, question, {
    getRevision: () => revision,
    getQueueTail: () => queueTail,
    setQueueTail: (tail) => {
      queueTail = tail;
    },
    followUpControllers,
    patchFollowUp,
    waitForRemotePassDone,
    cancelRemoteWaiter,
    subscribeAiEvents,
    mapAiError,
  });
}

export function disposeAiSummaries(): void {
  stopInitialization?.();
  for (const request of statusRequests) request.abort();
  statusSequence++;
  revision++;
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  abortAllFollowUps();
  unsubscribe?.();
  useAiSummaryStore.setState({ summaries: {}, scopes: {} });
}
