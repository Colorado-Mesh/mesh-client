import { useTranslation } from 'react-i18next';

import {
  aggregateNoiseFloorSamples,
  noiseFloorSparklinePoints,
} from '../lib/meshcore/noiseFloorHistory';
import { isElevatedNoiseFloor, type LocalNoiseFloorReading } from '../lib/rfNoiseFloor';
import {
  selectNoiseFloorSeries,
  useNoiseFloorHistoryStore,
} from '../stores/noiseFloorHistoryStore';

export interface RFNoiseFloorCardProps {
  /** Self node id for the active protocol; null when not connected. */
  myNodeId: number | null | undefined;
  /** Real hardware reading, or null. */
  reading: LocalNoiseFloorReading | null;
  /** Median RSSI − SNR fallback (null when too few samples). */
  estimatedNoiseFloor: number | null;
  /** Node count backing the estimate (for the caveat line). */
  estimateSampleCount: number;
}

export function RFNoiseFloorCard({
  myNodeId,
  reading,
  estimatedNoiseFloor,
  estimateSampleCount,
}: RFNoiseFloorCardProps) {
  const { t } = useTranslation();
  const samples = useNoiseFloorHistoryStore((s) =>
    selectNoiseFloorSeries(s, myNodeId != null && myNodeId > 0 ? myNodeId : 0),
  );
  const aggregate = aggregateNoiseFloorSamples(samples);
  const points = noiseFloorSparklinePoints(samples);
  const elevated = reading != null && isElevatedNoiseFloor(reading.value);

  return (
    <section
      className="rounded-card border-ink-700 border p-3"
      data-testid="rf-noise-floor-card"
      aria-labelledby="rf-noise-floor-heading"
    >
      <h3 id="rf-noise-floor-heading" className="text-ink-300 text-sm font-medium">
        {t('rfHistograms.noiseFloorTitle')}
      </h3>
      {reading != null ? (
        <>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-ink-200 font-mono text-base">
              {t('rfHistograms.noiseFloorValueDbm', { value: reading.value })}
            </span>
            {elevated ? (
              <span className="text-2xs rounded-badge bg-orange-800 px-1.5 py-0.5 text-white">
                {t('rfHistograms.noiseFloorElevated')}
              </span>
            ) : null}
          </div>
          <p className="text-muted text-xs">{t('rfHistograms.noiseFloorSourceRadio')}</p>
          {aggregate ? (
            <div
              className="text-ink-200 mt-2 grid grid-cols-3 gap-2 font-mono text-xs"
              aria-label={t('rfHistograms.noiseFloorHistoryAria', {
                min: aggregate.min,
                max: aggregate.max,
                last: aggregate.last,
              })}
            >
              <div>
                <span className="text-muted block">{t('rfHistograms.noiseFloorMin')}</span>
                {t('rfHistograms.noiseFloorValueDbm', { value: aggregate.min })}
              </div>
              <div>
                <span className="text-muted block">{t('rfHistograms.noiseFloorMax')}</span>
                {t('rfHistograms.noiseFloorValueDbm', { value: aggregate.max })}
              </div>
              <div>
                <span className="text-muted block">{t('rfHistograms.noiseFloorLast')}</span>
                {t('rfHistograms.noiseFloorValueDbm', { value: aggregate.last })}
              </div>
            </div>
          ) : null}
          {points ? (
            <svg
              viewBox="0 0 200 40"
              className="text-brand-green/60 mt-1 h-8 w-full"
              aria-hidden="true"
              data-testid="rf-noise-floor-sparkline"
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
            <p className="text-muted text-xs" data-testid="rf-noise-floor-collecting">
              {t('rfHistograms.noiseFloorCollecting')}
            </p>
          )}
        </>
      ) : estimatedNoiseFloor != null ? (
        <>
          <div
            className="text-ink-200 mt-1 font-mono text-base"
            data-testid="rf-noise-floor-estimate"
          >
            {t('rfHistograms.noiseFloorEstimatedValueDbm', { value: estimatedNoiseFloor })}
          </div>
          <p className="text-muted text-xs">
            {t('rfHistograms.noiseFloorEstimatedHint', { count: estimateSampleCount })}
          </p>
        </>
      ) : (
        <p className="text-muted mt-1 text-xs" data-testid="rf-noise-floor-empty">
          {t('rfHistograms.noiseFloorEmpty')}
        </p>
      )}
    </section>
  );
}
