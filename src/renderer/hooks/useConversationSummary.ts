import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type AiSummaryLiveMessage,
  mergeSummaryMessages,
  selectSummaryMessages,
} from '@/renderer/lib/aiSummaryScope';
import { chatReadClockMs } from '@/renderer/lib/chatReceiveOrder';
import { meshcoreDbMessageDisplay } from '@/renderer/lib/meshcoreChannelText';
import {
  aiReady,
  askFollowUp as askFollowUpAction,
  cancelFollowUp as cancelFollowUpAction,
  cancelSummary,
  dismissSummary,
  getAiSummaryRevision,
  runSummary,
  useAiSummaryStore,
} from '@/renderer/stores/aiSummaryStore';
import type { AiHistoryMessage, AiHistoryQuery } from '@/shared/ai-history';
import {
  AI_DEFAULT_MAX_COLLECTED_MESSAGES,
  AI_MAX_MESSAGES,
  AI_MAX_TOTAL_CHARS,
  type AiSummaryMessage,
  type AiSummaryRequest,
  type AiSummaryScope,
} from '@/shared/ai-types';
import { MS_PER_HOUR } from '@/shared/timeConstants';

export interface ConversationSummaryInput {
  key: string;
  label: string;
  protocol: AiSummaryRequest['protocol'];
  surface: AiSummaryRequest['surface'];
  messages: AiSummaryLiveMessage[];
  /** Read mark: the time of the last message read, on the clock `watermarkClock` names. */
  watermark: number;
  /**
   * Chat and Rooms marks are arrival times, so "since last read" reads history by arrival and
   * compares `order`. RRC marks are stamped times (`rrcReadWatermark.ts`), so its history is read
   * and compared by stamp.
   */
  watermarkClock: 'arrival' | 'stamp';
  history: Omit<AiHistoryQuery, 'sinceMs' | 'untilMs'> | null;
  includeHistoryMessage?: (message: AiHistoryMessage) => boolean;
  available?: boolean;
}
const UNREAD_SCOPE: AiSummaryScope = { kind: 'unread' };

async function fetchHistoryPages(
  base: Omit<AiHistoryQuery, 'sinceMs' | 'untilMs' | 'limit' | 'beforeAt' | 'beforeId'>,
  sinceMs: number,
  untilMs: number,
  maxCollected: number,
): Promise<{ messages: AiHistoryMessage[]; truncated: boolean }> {
  /** Newest-first across pages (page 1 = newest batch). */
  const newestFirst: AiHistoryMessage[] = [];
  let beforeAt: number | undefined;
  let beforeId: number | undefined;
  let truncated = false;
  while (newestFirst.length < maxCollected) {
    const pageLimit = Math.min(AI_MAX_MESSAGES, maxCollected - newestFirst.length);
    const page = await window.electronAPI.ai.getHistory({
      ...base,
      sinceMs,
      untilMs,
      limit: pageLimit,
      ...(beforeAt !== undefined && beforeId !== undefined ? { beforeAt, beforeId } : {}),
    });
    if (!page.length) break;
    // page is oldest→newest; LIMIT pageLimit+1 ⇒ length > pageLimit when older rows remain.
    const hasMore = page.length > pageLimit;
    const usable = hasMore ? page.slice(1) : page;
    if (!usable.length) break;
    for (const row of [...usable].reverse()) {
      if (newestFirst.length >= maxCollected) {
        break;
      }
      newestFirst.push(row);
    }
    // Only the latest page tells us whether older rows remain uncollected.
    truncated = hasMore;
    if (!hasMore || newestFirst.length >= maxCollected) break;
    const oldest = usable[0];
    if (oldest?.id == null) break;
    beforeAt = base.byArrival ? (oldest.order ?? oldest.at) : oldest.at;
    beforeId = oldest.id;
  }
  if (newestFirst.length > maxCollected) {
    truncated = true;
    newestFirst.length = maxCollected;
  }
  return { messages: [...newestFirst].reverse(), truncated };
}

export function useConversationSummary(input: ConversationSummaryInput) {
  const { i18n } = useTranslation();
  const status = useAiSummaryStore((s) => s.status);
  const enabled = useAiSummaryStore((s) => s.status?.enabled ?? s.cachedEnabled);
  const state = useAiSummaryStore((s) => s.summaries[input.key]);
  const scope = useAiSummaryStore((s) => s.scopes[input.key] ?? UNREAD_SCOPE);
  const setScope = (next: AiSummaryScope) => {
    useAiSummaryStore.getState().setScope(input.key, next);
  };
  const [loadingRequest, setLoadingRequest] = useState<{ key: string; owner: number } | null>(null);
  const [previousKey, setPreviousKey] = useState(input.key);
  if (previousKey !== input.key) {
    setPreviousKey(input.key);
    setLoadingRequest(null);
  }
  const loading = loadingRequest?.key === input.key;
  const current = useRef(input.key);
  const generation = useRef(0);
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
    };
    current.current = input.key;
    invalidate();
    let configurationRevision = getAiSummaryRevision();
    const unsubscribe = useAiSummaryStore.subscribe(() => {
      const nextRevision = getAiSummaryRevision();
      if (nextRevision === configurationRevision) return;
      configurationRevision = nextRevision;
      invalidate();
      setLoadingRequest(null);
    });
    return () => {
      invalidate();
      unsubscribe();
    };
  }, [input.key]);
  const run = useCallback(async () => {
    if (
      loading ||
      state?.streaming ||
      input.available === false ||
      !aiReady(useAiSummaryStore.getState().status)
    )
      return;
    const key = input.key;
    const runRevision = ++generation.current;
    const configurationRevision = getAiSummaryRevision();
    const isCurrent = () =>
      current.current === key &&
      generation.current === runRevision &&
      getAiSummaryRevision() === configurationRevision;
    setLoadingRequest({ key: input.key, owner: runRevision });
    try {
      const now = Date.now();
      const maxCollected =
        useAiSummaryStore.getState().status?.maxCollectedMessages ??
        AI_DEFAULT_MAX_COLLECTED_MESSAGES;
      let messages = input.messages;
      let truncated = false;
      let ceilingTruncated = false;
      if (scope.kind !== 'loaded' && input.history) {
        const sinceMs = scope.kind === 'unread' ? input.watermark : now - scope.hours * MS_PER_HOUR;
        // "Since last read" reads history on the read mark's clock: by arrival for an arrival
        // mark, up to the read clock (after a set-back of this clock new receipts run ahead of
        // it); by stamp up to this clock, as the hour ranges do, for a stamped one.
        const byArrival = scope.kind === 'unread' && input.watermarkClock === 'arrival';
        const { messages: history, truncated: historyTruncated } = await fetchHistoryPages(
          byArrival ? { ...input.history, byArrival: true } : input.history,
          Math.max(0, sinceMs),
          byArrival ? chatReadClockMs(now) : now,
          maxCollected,
        );
        truncated = historyTruncated;
        const normalized =
          input.protocol === 'meshcore'
            ? history.map((message) => {
                const display = meshcoreDbMessageDisplay({
                  sender_id: message.senderId,
                  sender_name: message.sender,
                  payload: message.body,
                });
                return {
                  at: message.at,
                  sender: display.sender_name,
                  body: display.payload,
                  senderId: display.sender_id,
                  ...(message.order != null ? { order: message.order } : {}),
                };
              })
            : history;
        const visible = input.includeHistoryMessage
          ? normalized.filter(input.includeHistoryMessage)
          : normalized;
        // History returns rows from the mark on, the last line read included; "since last read"
        // drops read lines on both sides first, so a read saved line is never matched to an unread
        // live line with the same stamp, sender and text (and the saved copy let through too).
        const inScope = <T extends AiSummaryLiveMessage>(rows: T[]): T[] =>
          scope.kind === 'unread'
            ? selectSummaryMessages({ messages: rows, scope, watermark: input.watermark, now })
            : rows;
        messages = mergeSummaryMessages(
          inScope(
            visible.map(({ at, sender, body, order }) =>
              order != null ? { at, sender, body, order } : { at, sender, body },
            ),
          ),
          inScope(messages),
        );
      }
      if (!isCurrent()) return;
      const selected = selectSummaryMessages({ messages, scope, watermark: input.watermark, now })
        .filter((m) => m.body.trim())
        .sort((a, b) => a.at - b.at);
      let chars = 0;
      const bounded: AiSummaryMessage[] = [];
      for (const message of selected.reverse()) {
        if (bounded.length >= maxCollected) {
          ceilingTruncated = true;
          truncated = true;
          break;
        }
        if (chars + message.body.length > AI_MAX_TOTAL_CHARS) {
          truncated = true;
          if (message.body.length > AI_MAX_TOTAL_CHARS) continue;
          break;
        }
        // The model gets the stamp, sender and text only.
        bounded.push({ at: message.at, sender: message.sender, body: message.body });
        chars += message.body.length;
      }
      await runSummary(
        key,
        {
          requestId: crypto.randomUUID(),
          conversationLabel: input.label,
          protocol: input.protocol,
          surface: input.surface,
          locale: i18n.language,
          messages: bounded.reverse(),
          scope,
        },
        truncated,
        selected.length,
        ceilingTruncated,
      );
    } catch (e: unknown) {
      console.debug('[renderer/hooks/useConversationSummary] catch:', e);

      if (isCurrent())
        useAiSummaryStore.setState((s) => ({
          summaries: {
            ...s.summaries,
            [key]: {
              requestId: '',
              text: '',
              streaming: false,
              provider: '',
              model: '',
              messageCount: 0,
              collectedMessageCount: 0,
              truncated: false,
              disclosure: '',
              error: 'error',
            },
          },
        }));
    } finally {
      setLoadingRequest((current) => (current?.owner === runRevision ? null : current));
    }
  }, [i18n.language, input, loading, scope, state?.streaming]);
  const cancel = () => {
    current.current = input.key;
    generation.current++;
    setLoadingRequest(null);
    cancelSummary(input.key);
  };
  return {
    key: input.key,
    showCatchUp: enabled && input.available !== false,
    canSummarize: aiReady(status) && input.available !== false,
    /** Model/engine chosen but not runnable (e.g. MLX selected without Metal helper). */
    engineNeedsFix:
      !!status?.enabled &&
      status.engine === 'bundled' &&
      !!status.localEngine.modelId &&
      !status.localEngine.ready,
    scope,
    setScope,
    run,
    cancel,
    dismiss: () => {
      cancel();
      dismissSummary(input.key);
    },
    state,
    pending: loading || state?.streaming === true,
    followUpPending: state?.followUps?.some((turn) => turn.streaming) ?? false,
    askFollowUp: (question: string) => {
      void askFollowUpAction(input.key, question);
    },
    cancelFollowUp: (id: string) => {
      cancelFollowUpAction(input.key, id);
    },
  };
}
export type ConversationSummaryController = ReturnType<typeof useConversationSummary>;
