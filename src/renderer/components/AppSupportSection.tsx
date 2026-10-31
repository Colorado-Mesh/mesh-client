import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { bundledWllamaThreadCount } from '@/renderer/lib/aiWorkerHost';
import {
  type CoiMemorySample,
  getCoiMemorySnapshot,
  sampleCoiMemoryNow,
  subscribeCoiMemorySnapshot,
} from '@/renderer/lib/coiMemorySampler';
import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { buildRendererMemorySparklineSegments } from '@/renderer/lib/rendererMemorySparkline';
import { getRendererTimingsSnapshot } from '@/renderer/lib/rendererTimings';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';
import type { SupportBundleMode } from '@/shared/support-bundle.types';

import { buttonClassName } from './ui/Button';
import { SettingsCollapsible } from './ui/SettingsSection';

interface AppSupportSectionProps {
  exporting: SupportBundleMode | null;
  onExport: (mode: SupportBundleMode) => Promise<void>;
}

function formatSignedMemory(bytes: number, formatMemory: (bytes: number) => string): string {
  const abs = formatMemory(Math.abs(bytes));
  if (bytes > 0) return `+${abs}`;
  if (bytes < 0) return `−${abs}`;
  return abs;
}

export function AppSupportSection({ exporting, onExport }: AppSupportSectionProps) {
  const { t, i18n } = useTranslation();
  const memory = useSyncExternalStore(subscribeCoiMemorySnapshot, getCoiMemorySnapshot);
  const use24Hour = useTimeFormatStore((state) => state.use24HourTime);
  const latest = memory.samples.at(-1);
  const previous = memory.samples.length >= 2 ? memory.samples.at(-2) : undefined;
  const source = latest?.source ?? 'user-agent';
  const samples = memory.samples.filter((sample) => (sample.source ?? 'user-agent') === source);
  const canSample = memory.supported && !memory.sampling;
  const timings = getRendererTimingsSnapshot();
  const threadBudget = bundledWllamaThreadCount();
  const sabAvailable = typeof SharedArrayBuffer === 'function';
  const formatMemory = (bytes: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage, {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    }).format(bytes / 1_000_000);
  const sparklineSegments = buildRendererMemorySparklineSegments(samples);
  const workingSetDelta = latest && previous ? latest.bytes - previous.bytes : undefined;
  const jsHeapDelta =
    latest?.jsHeapBytes != null && previous?.jsHeapBytes != null
      ? latest.jsHeapBytes - previous.jsHeapBytes
      : undefined;

  function historyDetail(sample: CoiMemorySample, index: number): string {
    const prior = index > 0 ? samples[index - 1] : undefined;
    const parts = [formatMemory(sample.bytes)];
    if (sample.jsHeapBytes != null) {
      parts.push(t('appPanel.memoryHistoryHeap', { value: formatMemory(sample.jsHeapBytes) }));
    }
    if (prior) {
      parts.push(
        t('appPanel.memoryHistoryDelta', {
          value: formatSignedMemory(sample.bytes - prior.bytes, formatMemory),
        }),
      );
    }
    return parts.join(' · ');
  }

  return (
    <>
      <SettingsCollapsible
        title={t('appPanel.supportSection')}
        description={t('appPanel.supportSectionDesc')}
      >
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
      </SettingsCollapsible>

      <SettingsCollapsible
        title={t('appPanel.memoryTitle')}
        anchorId="app.support.rendererMemory"
        titleAs="h3"
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            aria-label={t('appPanel.memorySampleNow')}
            disabled={!canSample}
            onClick={() => void sampleCoiMemoryNow()}
            className={buttonClassName('secondary', 'sm')}
          >
            {memory.sampling ? t('appPanel.memorySampling') : t('appPanel.memorySampleNow')}
          </button>
        </div>
        <div
          className="border-ink-800 bg-ink-900/40 space-y-1 rounded-lg border p-2"
          data-setting-anchor="app.support.coiCapability"
          aria-label={t('appPanel.coiCapabilityTitle')}
        >
          <p className="text-ink-200 text-xs font-medium">{t('appPanel.coiCapabilityTitle')}</p>
          <p className="text-muted text-xs">
            {t('appPanel.coiCapabilityIsolated', {
              value: memory.crossOriginIsolated ? t('appPanel.coiYes') : t('appPanel.coiNo'),
            })}
          </p>
          <p className="text-muted text-xs">
            {t('appPanel.coiCapabilitySab', {
              value: sabAvailable ? t('appPanel.coiYes') : t('appPanel.coiNo'),
            })}
          </p>
          <p className="text-muted text-xs">
            {t('appPanel.coiCapabilityThreads', { count: threadBudget })}
          </p>
          <p className="text-muted text-xs">
            {t('appPanel.coiCapabilityTiming', {
              value:
                timings.resolutionLabel === 'fine'
                  ? t('appPanel.coiTimingFine')
                  : t('appPanel.coiTimingCoarse'),
            })}
          </p>
        </div>
        <p className="text-muted text-xs">
          {source === 'renderer-process'
            ? t('appPanel.memoryRendererProcess')
            : t('appPanel.memoryDescription')}
        </p>
        {!memory.crossOriginIsolated && source === 'renderer-process' && (
          <p className="text-muted text-xs">{t('appPanel.memoryProcessOnly')}</p>
        )}
        <p className="text-muted text-xs">
          {memory.crossOriginIsolated
            ? t('appPanel.memoryIsolated')
            : t('appPanel.memoryNotIsolated')}
        </p>
        {!memory.supported && (
          <p className="text-muted text-xs">{t('appPanel.memoryUnsupported')}</p>
        )}
        <div role="status" className="text-ink-200 space-y-1 text-sm">
          {memory.failed ? (
            <p className="text-orange-300">{t('appPanel.memoryFailed')}</p>
          ) : latest ? (
            <>
              <p className="font-mono tabular-nums">
                {t('appPanel.memoryLatest', { value: formatMemory(latest.bytes) })}
              </p>
              {latest.jsHeapBytes != null && (
                <p className="text-muted font-mono text-xs tabular-nums">
                  {t('appPanel.memoryJsHeap', { value: formatMemory(latest.jsHeapBytes) })}
                </p>
              )}
              {workingSetDelta != null && (
                <p className="text-muted font-mono text-xs tabular-nums">
                  {t('appPanel.memoryDeltaWorkingSet', {
                    value: formatSignedMemory(workingSetDelta, formatMemory),
                  })}
                </p>
              )}
              {jsHeapDelta != null && (
                <p className="text-muted font-mono text-xs tabular-nums">
                  {t('appPanel.memoryDeltaJsHeap', {
                    value: formatSignedMemory(jsHeapDelta, formatMemory),
                  })}
                </p>
              )}
              {latest.domNodes != null && (
                <p className="text-muted text-xs">
                  {t('appPanel.memoryDomNodes', { count: latest.domNodes })}
                </p>
              )}
            </>
          ) : memory.supported ? (
            <p className="text-muted text-xs">{t('appPanel.memoryEmpty')}</p>
          ) : null}
        </div>
        {sparklineSegments.length > 0 && (
          <svg
            viewBox="0 0 300 50"
            preserveAspectRatio="none"
            className="text-bright-green h-12 w-full"
            aria-hidden="true"
          >
            {sparklineSegments.map((points) => (
              <polyline
                key={points}
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            ))}
          </svg>
        )}
        {latest && (
          <details className="text-muted text-xs">
            <summary className="cursor-pointer">{t('appPanel.memoryHistory')}</summary>
            <ul className="mt-2 space-y-1 font-mono tabular-nums">
              {samples.map((sample, index) => (
                <li key={`${sample.at}:${index}`} className="flex flex-wrap justify-between gap-2">
                  <time dateTime={new Date(sample.at).toISOString()}>
                    {formatDisplayTime(sample.at, { use24Hour, withSeconds: true })}
                  </time>
                  <span>{historyDetail(sample, index)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </SettingsCollapsible>
    </>
  );
}
