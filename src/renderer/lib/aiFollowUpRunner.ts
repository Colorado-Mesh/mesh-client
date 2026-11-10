import { selectFollowUpContext } from '@/renderer/lib/aiFollowUpContext';
import { executePass } from '@/renderer/lib/aiMultiPassSummary';
import { sanitizeAiModelOutput } from '@/renderer/lib/aiSummaryOutput';
import type { AiFollowUpTurnState } from '@/renderer/stores/aiSummaryStore';
import { aiReady, useAiSummaryStore } from '@/renderer/stores/aiSummaryStore';
import type { AiSummaryErrorReason, AiSummaryRequest } from '@/shared/ai-types';
import {
  AI_MAX_FOLLOW_UP_ANSWER_CHARS,
  AI_MAX_FOLLOW_UP_QUESTION_CHARS,
  AI_MAX_FOLLOW_UP_SUMMARY_CHARS,
  AI_MAX_FOLLOW_UP_TURNS,
  AI_MAX_RESPONSE_BYTES,
  AI_MAX_RETAINED_FOLLOW_UPS,
  aiSummaryTimeoutMs,
} from '@/shared/ai-types';

export interface AskFollowUpDeps {
  getRevision: () => number;
  getQueueTail: () => Promise<void> | undefined;
  setQueueTail: (tail: Promise<void> | undefined) => void;
  followUpControllers: Map<string, AbortController>;
  patchFollowUp: (key: string, id: string, update: Partial<AiFollowUpTurnState>) => void;
  waitForRemotePassDone: (
    requestId: string,
    conversationKey: string,
    silent: boolean,
    onChunk?: (delta: string) => void,
  ) => Promise<{ text: string; messageCount: number }>;
  cancelRemoteWaiter: (requestId: string) => void;
  subscribeAiEvents: () => void;
  mapAiError: (
    error: unknown,
    signal: AbortSignal,
    abortReason: () => AiSummaryErrorReason,
  ) => AiSummaryErrorReason;
}

/** Heavy Catch up follow-up path — loaded on first Ask to keep the App entry chunk slim. */
export async function runAskFollowUp(
  key: string,
  question: string,
  deps: AskFollowUpDeps,
): Promise<void> {
  const entry = useAiSummaryStore.getState().summaries[key];
  if (!entry || entry.streaming || !entry.text.trim() || entry.error) return;
  if (entry.followUps?.some((turn) => turn.streaming)) return;
  const status = useAiSummaryStore.getState().status;
  if (!aiReady(status) || !status?.engine) return;
  const trimmed = question.trim().slice(0, AI_MAX_FOLLOW_UP_QUESTION_CHARS);
  if (!trimmed) return;
  const base = entry.followUpBase;
  if (!base) return;

  deps.subscribeAiEvents();
  const turnId = crypto.randomUUID();
  const priorTurns = (entry.followUps ?? [])
    .filter((turn) => !turn.streaming && !turn.error && turn.answer.trim())
    .slice(-AI_MAX_FOLLOW_UP_TURNS)
    .map((turn) => ({
      question: turn.question,
      answer: turn.answer.slice(0, AI_MAX_FOLLOW_UP_ANSWER_CHARS),
    }));
  const selection = selectFollowUpContext(
    trimmed,
    entry.text,
    entry.followUpContext,
    status.engine,
  );
  const request: AiSummaryRequest = {
    requestId: turnId,
    ...base,
    messages: selection.messages,
    followUp: {
      question: trimmed,
      summary: entry.text.slice(0, AI_MAX_FOLLOW_UP_SUMMARY_CHARS),
      turns: priorTurns,
      contextKind: selection.contextKind,
    },
  };

  useAiSummaryStore.setState((state) => {
    const current = state.summaries[key];
    if (!current) return {};
    const turns = [
      ...(current.followUps ?? []),
      { id: turnId, question: trimmed, answer: '', streaming: true },
    ].slice(-AI_MAX_RETAINED_FOLLOW_UPS);
    return { summaries: { ...state.summaries, [key]: { ...current, followUps: turns } } };
  });

  const controller = new AbortController();
  deps.followUpControllers.set(turnId, controller);
  const before = deps.getRevision();
  const previous = deps.getQueueTail();
  let release!: () => void;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous ? previous.then(() => finished) : finished;
  deps.setQueueTail(tail);
  void tail.then(() => {
    if (deps.getQueueTail() === tail) deps.setQueueTail(undefined);
  });
  if (previous) deps.patchFollowUp(key, turnId, { queued: true });

  let signal: AbortSignal = controller.signal;
  const abortReason = (): AiSummaryErrorReason =>
    signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? 'timeout'
      : 'cancelled';
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => {
      reject(
        controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new DOMException('Follow-up cancelled', 'AbortError'),
      );
    };
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  void aborted.catch(() => {
    /* catch-no-log-ok cancellation is handled by the turn state */
  });

  try {
    if (previous) await Promise.race([previous, aborted]);
    controller.signal.throwIfAborted();
    if (before !== deps.getRevision()) return;
    deps.patchFollowUp(key, turnId, { queued: false });
    signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(aiSummaryTimeoutMs(status.engine, status.timeoutSeconds)),
    ]);
    const activePassIds = new Set<string>();
    const pass = await executePass(
      request,
      signal,
      null,
      true,
      {
        onProgress: () => {},
        onPhase: (phase) => {
          deps.patchFollowUp(key, turnId, { phase });
        },
        onFinalDelta: (delta) => {
          const current = useAiSummaryStore
            .getState()
            .summaries[key]?.followUps?.find((turn) => turn.id === turnId);
          if (!current?.streaming) return;
          const answer = current.answer + delta;
          if (answer.length <= AI_MAX_RESPONSE_BYTES)
            deps.patchFollowUp(key, turnId, { answer, phase: undefined });
        },
        onFinalText: (text) => {
          const answer = sanitizeAiModelOutput(text);
          deps.patchFollowUp(key, turnId, {
            answer,
            streaming: false,
            phase: undefined,
            ...(!answer.trim() ? { error: 'invalidResponse' as const } : {}),
          });
        },
        waitForSilentRemoteDone: (requestId) => {
          activePassIds.add(requestId);
          return deps.waitForRemotePassDone(requestId, key, true).finally(() => {
            activePassIds.delete(requestId);
          });
        },
        waitForStreamingRemoteDone: (requestId, onChunk) => {
          activePassIds.add(requestId);
          return deps.waitForRemotePassDone(requestId, key, false, onChunk).finally(() => {
            activePassIds.delete(requestId);
          });
        },
        cancelRemoteWaiter: (requestId) => {
          activePassIds.delete(requestId);
          deps.cancelRemoteWaiter(requestId);
        },
      },
      false,
      aiSummaryTimeoutMs(status.engine, status.timeoutSeconds),
      { requireFullCoverage: false },
    );
    const limited = selection.limited || pass.truncated;
    const current = useAiSummaryStore
      .getState()
      .summaries[key]?.followUps?.find((turn) => turn.id === turnId);
    if (current?.streaming)
      deps.patchFollowUp(key, turnId, {
        streaming: false,
        phase: undefined,
        truncated: limited,
      });
    else if (current && !current.error && limited)
      deps.patchFollowUp(key, turnId, { truncated: true });
  } catch (error) {
    // catch-no-log-ok never retain error details containing conversation content
    if (before === deps.getRevision())
      deps.patchFollowUp(key, turnId, {
        streaming: false,
        queued: false,
        phase: undefined,
        error: deps.mapAiError(error, signal, abortReason),
      });
  } finally {
    controller.signal.removeEventListener('abort', rejectAbort);
    deps.followUpControllers.delete(turnId);
    release();
  }
}
