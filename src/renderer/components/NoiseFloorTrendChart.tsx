import { useTranslation } from 'react-i18next';

import {
  aggregateNoiseFloorSamples,
  noiseFloorSparklinePoints,
} from '../lib/meshcore/noiseFloorHistory';
import {
  selectNoiseFloorSeries,
  useNoiseFloorHistoryStore,
} from '../stores/noiseFloorHistoryStore';

export interface NoiseFloorTrendChartProps {
  nodeId: number;
}

/**
 * Live noise-floor trend for a MeshCore node: empty state vs min/max/last + sparkline.
 * Zero dBm is shown as a real reading; "no data" only when the series is empty.
 */
export function NoiseFloorTrendChart({ nodeId }: NoiseFloorTrendChartProps) {
  const { t } = useTranslation();
  const samples = useNoiseFloorHistoryStore((s) => selectNoiseFloorSeries(s, nodeId));
  const aggregate = aggregateNoiseFloorSamples(samples);
  const points = noiseFloorSparklinePoints(samples);

  return (
    <div className="mt-2" data-testid="noise-floor-trend-chart">
      <div className="text-muted mb-0.5 text-xs font-semibold">
        {t('nodeDetailModal.noiseFloorTrendHeading')}
      </div>
      {aggregate == null ? (
        <p className="text-muted text-xs" data-testid="noise-floor-trend-empty">
          {t('nodeDetailModal.noiseFloorTrendEmpty')}
        </p>
      ) : (
        <div className="space-y-1" data-testid="noise-floor-trend-populated">
          <div
            className="text-ink-200 grid grid-cols-3 gap-2 font-mono text-xs"
            aria-label={t('nodeDetailModal.noiseFloorTrendStatsAria', {
              min: aggregate.min,
              max: aggregate.max,
              last: aggregate.last,
            })}
          >
            <div>
              <span className="text-muted block">{t('nodeDetailModal.noiseFloorTrendMin')}</span>
              {t('nodeDetailModal.noiseFloorTrendValueDbm', { value: aggregate.min })}
            </div>
            <div>
              <span className="text-muted block">{t('nodeDetailModal.noiseFloorTrendMax')}</span>
              {t('nodeDetailModal.noiseFloorTrendValueDbm', { value: aggregate.max })}
            </div>
            <div>
              <span className="text-muted block">{t('nodeDetailModal.noiseFloorTrendLast')}</span>
              {t('nodeDetailModal.noiseFloorTrendValueDbm', { value: aggregate.last })}
            </div>
          </div>
          {points ? (
            <svg
              viewBox="0 0 200 40"
              className="text-brand-green/60 h-8 w-full"
              aria-hidden="true"
              data-testid="noise-floor-trend-sparkline"
            >
              <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <p className="text-muted text-xs" data-testid="noise-floor-trend-awaiting-sparkline">
              {t('nodeDetailModal.noiseFloorTrendNeedMoreSamples')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
