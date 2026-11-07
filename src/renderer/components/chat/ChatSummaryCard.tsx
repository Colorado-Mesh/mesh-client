import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConversationSummaryController } from '@/renderer/hooks/useConversationSummary';
import { requestOpenSetting } from '@/renderer/lib/openSettingRequest';
import { AI_MAX_FOLLOW_UP_QUESTION_CHARS } from '@/shared/ai-types';

import { Button } from '../ui/Button';
import { INPUT_BOX_SM_CLASS } from '../ui/formClasses';

export function ChatSummaryCard({ summary }: { summary: ConversationSummaryController }) {
  const { t } = useTranslation();
  const [copyError, setCopyError] = useState(false);
  const [question, setQuestion] = useState('');
  const state = summary.state;
  if (!summary.canSummarize || !state) return null;
  const canCopy = !summary.pending && !state.streaming && !state.error && !!state.text.trim();
  const canAsk =
    !summary.pending &&
    !summary.followUpPending &&
    !state.streaming &&
    !state.error &&
    !!state.text.trim();
  return (
    <section
      className="border-ink-700 bg-deep-black mx-3 my-2 max-h-96 shrink-0 overflow-y-auto rounded-lg border p-3 text-sm"
      aria-label={t('aiSummary.catchUp')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ink-100 font-semibold">{t('aiSummary.catchUp')}</h3>
        <span className="text-muted text-xs">
          {state.disclosure
            ? t('aiSummary.sentTo', { host: state.disclosure })
            : t('aiSummary.onDevice')}
        </span>
      </div>
      <p className="text-muted text-xs">
        {state.messageCount === null
          ? t('aiSummary.providerCollected', {
              provider: state.provider,
              model: state.model,
              count: state.collectedMessageCount,
            })
          : t('aiSummary.providerIncluded', {
              provider: state.provider,
              model: state.model,
              count: state.collectedMessageCount,
              included: state.messageCount,
            })}
      </p>
      <p className="text-muted text-xs">{t('aiSummary.countSnapshot')}</p>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-ink-100 my-2 whitespace-pre-wrap"
      >
        {state.error
          ? t(`aiSummary.error.${state.error}`)
          : state.text ||
            (state.phase === 'queued'
              ? t('aiSummary.queued')
              : state.phase === 'chunking' && state.progress
                ? t('aiSummary.chunkProgress', {
                    current: state.progress.current,
                    total: state.progress.total,
                  })
                : state.phase === 'merging' && state.progress
                  ? t('aiSummary.mergeProgress', {
                      current: state.progress.current,
                      total: state.progress.total,
                    })
                  : state.phase === 'loadingModel'
                    ? t('aiSummary.loadingModel')
                    : state.phase === 'readingMessages'
                      ? t('aiSummary.readingMessages')
                      : t('aiSummary.working'))}
      </div>
      {state.ceilingTruncated && (
        <p className="text-xs text-orange-300">
          {t('aiSummary.ceilingTruncated', { count: state.collectedMessageCount })}
        </p>
      )}
      {state.truncated && <p className="text-xs text-orange-300">{t('aiSummary.truncated')}</p>}
      <p className="text-muted text-xs">{t('aiSummary.verify')}</p>
      {state.followUps?.length ? (
        <div className="mt-3 space-y-2" aria-label={t('aiSummary.followUps')}>
          {state.followUps.map((turn) => (
            <div key={turn.id} className="border-ink-800 border-t pt-2">
              <p className="text-ink-100 text-xs font-semibold">{turn.question}</p>
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="text-ink-100 mt-1 text-sm whitespace-pre-wrap"
              >
                {turn.error
                  ? t(`aiSummary.error.${turn.error}`)
                  : turn.answer ||
                    (turn.queued
                      ? t('aiSummary.followUpQueued')
                      : turn.phase === 'loadingModel'
                        ? t('aiSummary.loadingModel')
                        : turn.phase === 'readingMessages'
                          ? t('aiSummary.readingMessages')
                          : t('aiSummary.followUpWorking'))}
              </div>
              {turn.truncated && (
                <p className="mt-1 text-xs text-orange-300">
                  {t('aiSummary.followUpContextLimited')}
                </p>
              )}
              {turn.streaming && (
                <Button
                  size="sm"
                  className="mt-1"
                  aria-label={t('aiSummary.cancelFollowUp')}
                  onClick={() => {
                    summary.cancelFollowUp(turn.id);
                  }}
                >
                  {t('aiSummary.cancel')}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {canAsk || summary.followUpPending ? (
        <form
          className="mt-2 flex min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = question.trim();
            if (!value || !canAsk) return;
            summary.askFollowUp(value);
            setQuestion('');
          }}
        >
          <input
            className={`${INPUT_BOX_SM_CLASS} min-w-0 flex-1`}
            type="text"
            value={question}
            maxLength={AI_MAX_FOLLOW_UP_QUESTION_CHARS}
            aria-label={t('aiSummary.followUpQuestion')}
            placeholder={t('aiSummary.followUpPlaceholder')}
            disabled={!canAsk}
            onChange={(event) => {
              setQuestion(event.target.value);
            }}
          />
          <Button
            size="sm"
            type="submit"
            aria-label={t('aiSummary.askFollowUp')}
            disabled={!canAsk || !question.trim()}
          >
            {t('aiSummary.askFollowUp')}
          </Button>
        </form>
      ) : null}
      {state.followUpContext?.limited &&
        !!state.text.trim() &&
        !state.error &&
        !state.streaming && (
          <p className="text-muted mt-1 text-xs">{t('aiSummary.followUpContextLimited')}</p>
        )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          aria-label={t('aiSummary.copy')}
          disabled={!canCopy}
          onClick={() => {
            void navigator.clipboard.writeText(state.text).then(
              () => {
                setCopyError(false);
              },
              () => {
                setCopyError(true);
              },
            );
          }}
        >
          {t('aiSummary.copy')}
        </Button>
        {summary.pending ? (
          <Button size="sm" aria-label={t('aiSummary.cancel')} onClick={summary.cancel}>
            {t('aiSummary.cancel')}
          </Button>
        ) : (
          <Button
            size="sm"
            aria-label={t('aiSummary.regenerate')}
            onClick={() => {
              void summary.run();
            }}
          >
            {t('aiSummary.regenerate')}
          </Button>
        )}
        <Button size="sm" aria-label={t('aiSummary.dismiss')} onClick={summary.dismiss}>
          {t('aiSummary.dismiss')}
        </Button>
        <Button
          size="sm"
          aria-label={t('aiSummary.settings')}
          onClick={() => {
            requestOpenSetting({ slot: 'App', id: 'app.aiProvider' });
          }}
        >
          {t('aiSummary.settings')}
        </Button>
      </div>
      {copyError && <p role="alert">{t('aiSummary.copyFailed')}</p>}
    </section>
  );
}
