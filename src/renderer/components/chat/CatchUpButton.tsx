import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConversationSummaryController } from '@/renderer/hooks/useConversationSummary';
import { requestOpenSetting } from '@/renderer/lib/openSettingRequest';

import { Button } from '../ui/Button';
import { INPUT_BOX_SM_CLASS, SELECT_BOX_CLASS } from '../ui/formClasses';

export function CatchUpButton({ summary }: { summary: ConversationSummaryController }) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState('12');
  const [customMode, setCustomMode] = useState(false);
  if (!summary.showCatchUp) return null;
  if (!summary.canSummarize)
    return (
      <Button
        size="sm"
        aria-label={t('aiSummary.setupCatchUp')}
        title={t('aiSummary.settings')}
        onClick={() => {
          requestOpenSetting({ slot: 'App', id: 'app.aiProvider' });
        }}
      >
        {t('aiSummary.setupCatchUp')}
      </Button>
    );
  const value = summary.scope.kind === 'hours' ? String(summary.scope.hours) : summary.scope.kind;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <Button
        size="sm"
        aria-label={t('aiSummary.catchUp')}
        disabled={summary.pending}
        onClick={() => {
          void summary.run();
        }}
      >
        {t('aiSummary.catchUp')}
      </Button>
      <select
        className={`${SELECT_BOX_CLASS} max-w-32 text-xs`}
        aria-label={t('aiSummary.scope')}
        value={customMode ? 'custom' : value}
        disabled={summary.pending}
        onChange={(event) => {
          const v = event.target.value;
          setCustomMode(v === 'custom');
          if (v === 'unread' || v === 'loaded') summary.setScope({ kind: v });
          else
            summary.setScope({
              kind: 'hours',
              hours: v === 'custom' ? Number(custom) || 12 : Number(v),
            });
        }}
      >
        <option value="unread">{t('aiSummary.unread')}</option>
        <option value="1">{t('aiSummary.hours', { count: 1 })}</option>
        <option value="6">{t('aiSummary.hours', { count: 6 })}</option>
        <option value="24">{t('aiSummary.hours', { count: 24 })}</option>
        <option value="custom">{t('aiSummary.customHours')}</option>
        <option value="loaded">{t('aiSummary.loaded')}</option>
      </select>
      {customMode && (
        <input
          className={`${INPUT_BOX_SM_CLASS} w-20`}
          type="number"
          min={0.1}
          max={8760}
          step={0.5}
          aria-label={t('aiSummary.customHours')}
          value={custom}
          onChange={(event) => {
            setCustom(event.target.value);
            const hours = Number(event.target.value);
            if (Number.isFinite(hours) && hours > 0 && hours <= 8760)
              summary.setScope({ kind: 'hours', hours });
          }}
        />
      )}
    </div>
  );
}
