import { useTranslation } from 'react-i18next';

import { useNowMs } from '@/renderer/hooks/useNowMs';
import { MS_PER_DAY } from '@/renderer/lib/timeConstants';
import {
  type EnvironmentHistoryPoint,
  selectEnvironmentSeries,
  useEnvironmentTelemetryStore,
} from '@/renderer/stores/environmentTelemetryStore';
import type { EnvironmentReadingField } from '@/shared/environmentTelemetry';
import type { MeshProtocol } from '@/shared/meshProtocol';

const SPARKLINE_METRICS = [
  { metric: 'temperature', labelKey: 'sensorLayer.sparklineTemperature24h' },
  { metric: 'relativeHumidity', labelKey: 'sensorLayer.sparklineHumidity24h' },
] as const satisfies readonly { metric: EnvironmentReadingField; labelKey: string }[];

/** SVG polyline points for `metric` over `points`, or null with fewer than two samples. */
export function sparklinePoints(
  points: readonly EnvironmentHistoryPoint[],
  metric: EnvironmentReadingField,
  sinceMs: number,
): string | null {
  const samples: { t: number; v: number }[] = [];
  for (const p of points) {
    const v = p.reading[metric];
    if (p.t >= sinceMs && v !== undefined) samples.push({ t: p.t, v });
  }
  if (samples.length < 2) return null;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const s of samples) {
    minV = Math.min(minV, s.v);
    maxV = Math.max(maxV, s.v);
  }
  const range = maxV - minV || 1;
  const minT = samples[0].t;
  const timeRange = samples[samples.length - 1].t - minT || 1;
  return samples
    .map((s) => {
      const x = ((s.t - minT) / timeRange) * 200;
      const y = 40 - ((s.v - minV) / range) * 36 - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function EnvironmentSparklines({
  protocol,
  nodeId,
}: {
  protocol: MeshProtocol;
  nodeId: number;
}) {
  const { t } = useTranslation();
  const series = useEnvironmentTelemetryStore((s) => selectEnvironmentSeries(s, protocol, nodeId));
  const nowMs = useNowMs();
  if (series.length < 2) return null;
  const since = nowMs - MS_PER_DAY;
  return (
    <>
      {SPARKLINE_METRICS.map(({ metric, labelKey }) => {
        const points = sparklinePoints(series, metric, since);
        if (!points) return null;
        return (
          <div key={metric} className="mt-2" data-testid={`env-sparkline-${metric}`}>
            <div className="text-label text-muted mb-0.5">{t(labelKey)}</div>
            <svg viewBox="0 0 200 40" className="text-brand-green/60 h-8 w-full" aria-hidden="true">
              <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </div>
        );
      })}
    </>
  );
}
