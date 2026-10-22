import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getCoiMemorySnapshot,
  sampleCoiMemoryNow,
  subscribeCoiMemorySnapshot,
} from '@/renderer/lib/coiMemorySampler';
import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';
import type { SupportBundleMode } from '@/shared/support-bundle.types';

import { buttonClassName } from './ui/Button';

interface AppSupportSectionProps {
  exporting: SupportBundleMode | null;
  onExport: (mode: SupportBundleMode) => Promise<void>;
}

export function AppSupportSection({ exporting, onExport }: AppSupportSectionProps) {
  const { t, i18n } = useTranslation();
  const memory = useSyncExternalStore(subscribeCoiMemorySnapshot, getCoiMemorySnapshot);
  const use24Hour = useTimeFormatStore((state) => state.use24HourTime);
  const latest = memory.samples.at(-1);
  const formatMemory = (bytes: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage, {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    }).format(bytes / 1_000_000);
  const historyMax = Math.max(1, ...memory.samples.map((sample) => sample.bytes));
  const historyPoints = memory.samples
    .map(
      (sample, index) =>
        `${(index / Math.max(1, memory.samples.length - 1)) * 300},${46 - (sample.bytes / historyMax) * 42}`,
    )
    .join(' ');

  return (
    <section className="space-y-3" aria-label={t('appPanel.supportSection')}>
      <h3 className="text-muted text-sm font-medium">{t('appPanel.supportSection')}</h3>
      <p className="text-muted text-xs">{t('appPanel.supportSectionDesc')}</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div data-setting-anchor="app.support.exportForGitHub" className="space-y-2">
          <button
            type="button"
            aria-label={t('appPanel.exportForGitHub')}
            disabled={exporting !== null}
            onClick={() => void onExport('github')}
            className={buttonClassName('primary', 'md')}
          >
            {exporting === 'github' ? t('common.loading') : t('appPanel.exportForGitHubButton')}
          </button>
          <p className="text-muted text-xs">{t('appPanel.exportForGitHubDesc')}</p>
        </div>
        <div data-setting-anchor="app.support.exportForDeveloper" className="space-y-2">
          <button
            type="button"
            aria-label={t('appPanel.exportForDeveloper')}
            disabled={exporting !== null}
            onClick={() => void onExport('developer')}
            className={buttonClassName('secondary', 'md')}
          >
            {exporting === 'developer'
              ? t('common.loading')
              : t('appPanel.exportForDeveloperButton')}
          </button>
          <p className="text-xs text-orange-300">{t('appPanel.exportForDeveloperWarning')}</p>
        </div>
      </div>
      <div
        data-setting-anchor="app.support.rendererMemory"
        className="border-ink-800 space-y-2 border-t pt-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-ink-200 text-sm font-medium">{t('appPanel.memoryTitle')}</h4>
          <button
            type="button"
            aria-label={t('appPanel.memorySampleNow')}
            disabled={!memory.crossOriginIsolated || !memory.supported || memory.sampling}
            onClick={() => void sampleCoiMemoryNow()}
            className={buttonClassName('secondary', 'sm')}
          >
            {memory.sampling ? t('appPanel.memorySampling') : t('appPanel.memorySampleNow')}
          </button>
        </div>
        <p className="text-muted text-xs">{t('appPanel.memoryDescription')}</p>
        <p className="text-muted text-xs">
          {memory.crossOriginIsolated
            ? t('appPanel.memoryIsolated')
            : t('appPanel.memoryNotIsolated')}
        </p>
        {memory.crossOriginIsolated && !memory.supported && (
          <p className="text-muted text-xs">{t('appPanel.memoryUnsupported')}</p>
        )}
        <div role="status" className="text-ink-200 text-sm">
          {memory.failed ? (
            <p className="text-orange-300">{t('appPanel.memoryFailed')}</p>
          ) : latest ? (
            <p className="font-mono tabular-nums">
              {t('appPanel.memoryLatest', { value: formatMemory(latest.bytes) })}
            </p>
          ) : memory.crossOriginIsolated && memory.supported ? (
            <p className="text-muted text-xs">{t('appPanel.memoryEmpty')}</p>
          ) : null}
        </div>
        {memory.samples.length > 1 && (
          <svg
            viewBox="0 0 300 50"
            preserveAspectRatio="none"
            className="text-bright-green h-12 w-full"
            aria-hidden="true"
          >
            <polyline points={historyPoints} fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        )}
        {latest && (
          <details className="text-muted text-xs">
            <summary className="cursor-pointer">{t('appPanel.memoryHistory')}</summary>
            <ul className="mt-2 space-y-1 font-mono tabular-nums">
              {memory.samples.map((sample, index) => (
                <li key={`${sample.at}:${index}`} className="flex flex-wrap justify-between gap-2">
                  <time dateTime={new Date(sample.at).toISOString()}>
                    {formatDisplayTime(sample.at, { use24Hour, withSeconds: true })}
                  </time>
                  <span>{formatMemory(sample.bytes)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
