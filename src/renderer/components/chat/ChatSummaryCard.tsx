import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConversationSummaryController } from '@/renderer/hooks/useConversationSummary';
import { requestOpenSetting } from '@/renderer/lib/openSettingRequest';

import { Button } from '../ui/Button';

export function ChatSummaryCard({ summary }: { summary: ConversationSummaryController }) {
  const { t } = useTranslation();
  const [copyError, setCopyError] = useState(false);
  const state = summary.state;
  if (!summary.canSummarize || !state) return null;
  const canCopy = !summary.pending && !state.streaming && !state.error && !!state.text.trim();
  return (
    <section
      className="border-ink-700 bg-deep-black mx-3 my-2 max-h-80 shrink-0 overflow-y-auto rounded-lg border p-3 text-sm"
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
            (state.phase === 'loadingModel'
              ? t('aiSummary.loadingModel')
              : state.phase === 'readingMessages'
                ? t('aiSummary.readingMessages')
                : t('aiSummary.working'))}
      </div>
      {state.truncated && <p className="text-xs text-orange-300">{t('aiSummary.truncated')}</p>}
      <p className="text-muted text-xs">{t('aiSummary.verify')}</p>
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
