import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { hasEffectiveReticulumPropagationTarget } from '@/renderer/lib/reticulum/reticulumPropagationEffective';
import { readReticulumPropagationMode } from '@/renderer/lib/reticulum/reticulumPropagationMode';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

export interface ReticulumPropagationNoticeProps {
  stackLive: boolean;
  onOpenPropagationSettings?: () => void;
}

/** Persistent banner when the stack is up but no remote propagation node is configured. */
export function ReticulumPropagationNotice({
  stackLive,
  onOpenPropagationSettings,
}: ReticulumPropagationNoticeProps) {
  const { t } = useTranslation();
  const nodes = useReticulumPropagationStore((s) => s.nodes);
  const preferredId = useReticulumPropagationStore((s) => s.preferredId);
  const refreshFromSidecar = useReticulumPropagationStore((s) => s.refreshFromSidecar);

  useEffect(() => {
    if (!stackLive) return;
    void refreshFromSidecar();
  }, [stackLive, refreshFromSidecar]);

  if (!stackLive) return null;
  if (hasEffectiveReticulumPropagationTarget(nodes, preferredId, readReticulumPropagationMode())) {
    return null;
  }

  return (
    <div
      role="alert"
      className="mb-2 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-100"
    >
      <p>{t('reticulumPropagation.notice.body')}</p>
      {onOpenPropagationSettings ? (
        <button
          type="button"
          className="mt-1.5 font-medium text-amber-200 underline hover:text-amber-100"
          aria-label={t('reticulumPropagation.notice.openSettingsAria')}
          onClick={onOpenPropagationSettings}
        >
          {t('reticulumPropagation.notice.openSettings')}
        </button>
      ) : null}
    </div>
  );
}
