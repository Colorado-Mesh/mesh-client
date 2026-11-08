import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ElevationProfileResult } from '@/shared/elevation/types';

import { MAP_OVERLAY_PANEL_CLASS } from './mapControlClasses';

const WIDTH = 320;
const HEIGHT = 120;
const PAD = { top: 8, right: 8, bottom: 20, left: 36 };

export interface TerrainProfileChartProps {
  result: ElevationProfileResult | null;
  loading?: boolean;
  errorKey?: string | null;
}

export function TerrainProfileChart({
  result,
  loading,
  errorKey,
}: TerrainProfileChartProps): React.JSX.Element {
  const { t } = useTranslation();

  const paths = useMemo(() => {
    if (!result || result.samples.length < 2) return null;
    const samples = result.samples;
    const terrainVals = samples
      .map((s) => s.effectiveElevationM ?? s.elevationM)
      .filter((e): e is number => e != null);
    const losVals = samples.map((s) => s.losHeightM).filter((e): e is number => e != null);
    const fresnelLowerVals = samples
      .filter((s) => s.losHeightM != null && s.fresnelRadiusM != null)
      .map((s) => s.losHeightM! - s.fresnelRadiusM!);
    if (terrainVals.length === 0) return null;
    const minY =
      Math.min(...terrainVals, ...(losVals.length ? losVals : terrainVals), ...fresnelLowerVals) -
      5;
    const maxY = Math.max(...terrainVals, ...(losVals.length ? losVals : terrainVals)) + 5;
    const maxX = result.totalDistanceM || 1;
    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;

    const xScale = (d: number) => PAD.left + (d / maxX) * plotW;
    const yScale = (v: number) => PAD.top + plotH - ((v - minY) / (maxY - minY || 1)) * plotH;

    const terrain = samples
      .map((s) => ({
        distanceM: s.distanceM,
        y: s.effectiveElevationM ?? s.elevationM,
      }))
      .filter((s): s is { distanceM: number; y: number } => s.y != null)
      .map(
        (s, i) =>
          `${i === 0 ? 'M' : 'L'}${xScale(s.distanceM).toFixed(1)},${yScale(s.y).toFixed(1)}`,
      )
      .join(' ');

    const los = samples
      .filter((s) => s.losHeightM != null)
      .map(
        (s, i) =>
          `${i === 0 ? 'M' : 'L'}${xScale(s.distanceM).toFixed(1)},${yScale(s.losHeightM!).toFixed(1)}`,
      )
      .join(' ');

    // Fresnel lower bound ≈ los − fresnelRadius
    const fresnelLower = samples
      .filter((s) => s.losHeightM != null && s.fresnelRadiusM != null)
      .map((s, i) => {
        const y = s.losHeightM! - s.fresnelRadiusM!;
        return `${i === 0 ? 'M' : 'L'}${xScale(s.distanceM).toFixed(1)},${yScale(y).toFixed(1)}`;
      })
      .join(' ');

    return { terrain, los, fresnelLower, minY, maxY, maxX };
  }, [result]);

  const statusLabel =
    result == null
      ? null
      : result.clearance === 'clear'
        ? t('mapPanel.terrainProfile.clear')
        : result.clearance === 'obstructed'
          ? t('mapPanel.terrainProfile.obstructed')
          : t('mapPanel.terrainProfile.unknown');

  const statusClass =
    result?.clearance === 'clear'
      ? 'text-green-400'
      : result?.clearance === 'obstructed'
        ? 'text-red-400'
        : 'text-ink-300';

  return (
    <div
      className={`${MAP_OVERLAY_PANEL_CLASS} w-[min(100%,20rem)]`}
      role="region"
      aria-label={t('mapPanel.terrainProfile.chartAria')}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-ink-100 text-xs font-medium">
          {t('mapPanel.terrainProfile.title')}
        </span>
        {statusLabel ? (
          <span className={`text-xs font-medium ${statusClass}`}>{statusLabel}</span>
        ) : null}
      </div>
      {loading ? (
        <p className="text-ink-300 text-xs">{t('mapPanel.terrainProfile.loading')}</p>
      ) : null}
      {errorKey ? (
        <p className="text-xs text-red-400" role="alert">
          {t(errorKey)}
        </p>
      ) : null}
      {paths ? (
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="max-w-full"
          aria-hidden
        >
          <path
            d={paths.terrain}
            fill="none"
            stroke="currentColor"
            className="text-ink-400"
            strokeWidth={2}
          />
          {paths.fresnelLower ? (
            <path
              d={paths.fresnelLower}
              fill="none"
              stroke="currentColor"
              className="text-orange-400/70"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          ) : null}
          {paths.los ? (
            <path
              d={paths.los}
              fill="none"
              stroke="currentColor"
              className="text-sky-400"
              strokeWidth={1.5}
            />
          ) : null}
          <text x={PAD.left} y={HEIGHT - 4} className="fill-ink-400 text-2xs">
            0
          </text>
          <text x={WIDTH - PAD.right - 28} y={HEIGHT - 4} className="fill-ink-400 text-2xs">
            {(paths.maxX / 1000).toFixed(1)} km
          </text>
        </svg>
      ) : !loading && !errorKey ? (
        <p className="text-ink-300 text-label">{t('mapPanel.terrainProfile.needEndpoints')}</p>
      ) : null}
      {result ? (
        <p className="text-ink-400 text-2xs mt-1">
          {t('mapPanel.terrainProfile.meta', {
            mhz: result.frequencyMhz,
            km: (result.totalDistanceM / 1000).toFixed(2),
            clearance:
              result.minClearanceM == null
                ? '—'
                : `${result.minClearanceM >= 0 ? '+' : ''}${result.minClearanceM.toFixed(1)} m`,
          })}
          {result.fullyOffline
            ? ` · ${t('mapPanel.terrainProfile.offlineSource')}`
            : result.usedNetwork
              ? ` · ${t('mapPanel.terrainProfile.networkSource')}`
              : ''}
        </p>
      ) : null}
    </div>
  );
}
