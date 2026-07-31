import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  RMAP_GLOBAL_MAP_URL,
  rmapPublishCoverageTone,
  summarizeRmapPublishStatus,
} from '@/renderer/lib/reticulum/reticulumRmapDiscovery';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';

export interface ReticulumRmapConnectionStatusProps {
  interfaces: readonly ReticulumInterfaceRow[];
  sidecarApiReady: boolean;
  onOpenRmapSettings?: () => void;
}

/** Connection tab summary for RMAP v4 publish state. */
export function ReticulumRmapConnectionStatus({
  interfaces,
  sidecarApiReady,
  onOpenRmapSettings,
}: ReticulumRmapConnectionStatusProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => summarizeRmapPublishStatus(interfaces), [interfaces]);
  const tone = useMemo(() => rmapPublishCoverageTone(summary), [summary]);

  if (!sidecarApiReady) {
    return null;
  }

  const statusClass =
    tone === 'full' ? 'text-brand-green' : tone === 'partial' ? 'text-amber-300' : 'text-gray-400';

  return (
    <div className="rounded border border-gray-700 bg-slate-900/40 px-3 py-2 text-xs" role="status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={statusClass}>
          {tone === 'off'
            ? t('connectionPanel.reticulumRmap.notPublishing')
            : t('connectionPanel.reticulumRmap.publishingOf', {
                current: summary.discoverableCount,
                total: summary.publishTargetCount,
              })}
        </span>
        {onOpenRmapSettings ? (
          <button
            type="button"
            className="text-amber-300 hover:text-amber-200 hover:underline"
            aria-label={t('connectionPanel.reticulumRmap.openSettingsAria')}
            onClick={onOpenRmapSettings}
          >
            {t('connectionPanel.reticulumRmap.openSettings')}
          </button>
        ) : null}
        <a
          href={RMAP_GLOBAL_MAP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-300 hover:text-cyan-200 hover:underline"
          aria-label={t('connectionPanel.reticulumRmap.openGlobalMapAria')}
        >
          {t('connectionPanel.reticulumRmap.openGlobalMap')}
        </a>
      </div>
      {summary.publishTargetCount === 0 ? (
        <p className="mt-1 text-gray-400">{t('connectionPanel.reticulumRmap.noPublishTargets')}</p>
      ) : null}
    </div>
  );
}
