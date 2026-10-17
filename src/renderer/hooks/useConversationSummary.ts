import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mergeSummaryMessages, selectSummaryMessages } from '@/renderer/lib/aiSummaryScope';
import { meshcoreDbMessageDisplay } from '@/renderer/lib/meshcoreChannelText';
import {
  aiReady,
  cancelSummary,
  dismissSummary,
  getAiSummaryRevision,
  runSummary,
  useAiSummaryStore,
} from '@/renderer/stores/aiSummaryStore';
import type { AiHistoryMessage, AiHistoryQuery } from '@/shared/ai-history';
import {
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
  messages: AiSummaryMessage[];
  watermark: number;
  history: Omit<AiHistoryQuery, 'sinceMs' | 'untilMs'> | null;
  includeHistoryMessage?: (message: AiHistoryMessage) => boolean;
  available?: boolean;
}
export function useConversationSummary(input: ConversationSummaryInput) {
  const { i18n } = useTranslation();
  const status = useAiSummaryStore((s) => s.status);
  const state = useAiSummaryStore((s) => s.summaries[input.key]);
  const [scope, setScope] = useState<AiSummaryScope>({ kind: 'unread' });
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
      let messages = input.messages;
      let truncated = false;
      if (scope.kind !== 'loaded' && input.history) {
        const sinceMs = scope.kind === 'unread' ? input.watermark : now - scope.hours * MS_PER_HOUR;
        const history = await window.electronAPI.ai.getHistory({
          ...input.history,
          sinceMs: Math.max(0, sinceMs),
          untilMs: now,
        });
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
                };
              })
            : history;
        const visible = input.includeHistoryMessage
          ? normalized.filter(input.includeHistoryMessage)
          : normalized;
        messages = mergeSummaryMessages(
          visible.map(({ at, sender, body }) => ({ at, sender, body })),
          messages,
        );
        truncated = history.length > AI_MAX_MESSAGES;
      }
      if (!isCurrent()) return;
      const selected = selectSummaryMessages({ messages, scope, watermark: input.watermark, now })
        .filter((m) => m.body.trim())
        .sort((a, b) => a.at - b.at);
      let chars = 0;
      const bounded: AiSummaryMessage[] = [];
      for (const message of selected.reverse()) {
        if (bounded.length >= AI_MAX_MESSAGES) {
          truncated = true;
          break;
        }
        if (chars + message.body.length > AI_MAX_TOTAL_CHARS) {
          truncated = true;
          continue;
        }
        bounded.push(message);
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
      );
    } catch {
      // catch-no-log-ok history errors expose only a fixed actionable summary error
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
    showCatchUp: status?.enabled === true && input.available !== false,
    canSummarize: aiReady(status) && input.available !== false,
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
  };
}
export type ConversationSummaryController = ReturnType<typeof useConversationSummary>;
