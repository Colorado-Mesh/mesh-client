import { Pause, Play } from 'lucide-react-motion';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useNowMs } from '@/renderer/hooks/useNowMs';
import { formatDisplayDateTime } from '@/renderer/lib/formatDisplayTime';
import { readReduceMotion } from '@/renderer/lib/reduceMotionPreference';
import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { MAP_OVERLAY_PANEL_CLASS } from './mapControlClasses';

const FRAME_INTERVAL_MS = 500;

export function WeatherOverlayBar(): React.JSX.Element | null {
  const { t } = useTranslation();
  const frames = useInternetWeatherStore((s) => s.radarFrames);
  const frameIndex = useInternetWeatherStore((s) => s.radarFrameIndex);
  const playing = useInternetWeatherStore((s) => s.radarPlaying);
  const opacity = useInternetWeatherStore((s) => s.radarOpacity);
  const showCoverage = useInternetWeatherStore((s) => s.showCoverage);
  const lastUpdatedMs = useInternetWeatherStore((s) => s.lastUpdatedMs);
  const setFrameIndex = useInternetWeatherStore((s) => s.setRadarFrameIndex);
  const setPlaying = useInternetWeatherStore((s) => s.setRadarPlaying);
  const setOpacity = useInternetWeatherStore((s) => s.setRadarOpacity);
  const setShowCoverage = useInternetWeatherStore((s) => s.setShowCoverage);
  const use24h = useTimeFormatStore((s) => s.use24HourTime);
  const nowMs = useNowMs(true, 30 * MS_PER_SECOND);

  useEffect(() => {
    if (readReduceMotion()) setPlaying(false);
  }, [setPlaying]);

  useEffect(() => {
    if (!playing || !frames || frames.frames.length === 0) return;
    const id = window.setInterval(() => {
      const next = (useInternetWeatherStore.getState().radarFrameIndex + 1) % frames.frames.length;
      setFrameIndex(next);
    }, FRAME_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [playing, frames, setFrameIndex]);

  if (!frames || frames.frames.length === 0) {
    return (
      <div className={`${MAP_OVERLAY_PANEL_CLASS} max-w-xs`}>
        <div className="text-ink-300 text-xs">{t('internetWeather.noRadar')}</div>
      </div>
    );
  }

  const frame = frames.frames[frameIndex];
  const timeLabel = formatDisplayDateTime(frame.timeMs, { use24Hour: use24h });
  const stale = lastUpdatedMs != null && nowMs > 0 && nowMs - lastUpdatedMs > 20 * 60 * 1000;

  return (
    <div
      className={`${MAP_OVERLAY_PANEL_CLASS} flex max-w-sm flex-col gap-2`}
      role="group"
      aria-label={t('internetWeather.layerRadar')}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="bg-brand-green text-app-bg rounded-control p-1"
          aria-pressed={playing}
          aria-label={playing ? t('internetWeather.pause') : t('internetWeather.play')}
          onClick={() => {
            setPlaying(!playing);
          }}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
        <span className="text-ink-100 text-xs">{timeLabel}</span>
        <span className="text-ink-400 text-2xs">
          {frames.provider === 'iem-nexrad'
            ? t('internetWeather.providerNexrad')
            : t('internetWeather.providerRainViewer')}
        </span>
      </div>
      <label className="text-ink-300 text-2xs flex flex-col gap-1">
        <span>{t('internetWeather.frameTime', { time: timeLabel })}</span>
        <input
          type="range"
          min={0}
          max={frames.frames.length - 1}
          step={1}
          value={frameIndex}
          aria-label={t('internetWeather.frameTime', { time: timeLabel })}
          aria-valuetext={timeLabel}
          onChange={(e) => {
            setFrameIndex(Number(e.target.value));
          }}
        />
      </label>
      <label className="text-ink-300 text-2xs flex flex-col gap-1">
        <span>{t('internetWeather.opacity')}</span>
        <input
          type="range"
          min={20}
          max={90}
          step={5}
          value={Math.round(opacity * 100)}
          aria-label={t('internetWeather.opacity')}
          onChange={(e) => {
            setOpacity(Number(e.target.value) / 100);
          }}
        />
      </label>
      {frames.coverageUrlTemplate ? (
        <label className="text-ink-300 text-2xs flex items-center gap-2">
          <input
            type="checkbox"
            checked={showCoverage}
            aria-label={t('internetWeather.showCoverage')}
            onChange={(e) => {
              setShowCoverage(e.target.checked);
            }}
          />
          {t('internetWeather.showCoverage')}
        </label>
      ) : null}
      {stale && lastUpdatedMs != null ? (
        <div className="text-2xs text-orange-400">
          {t('internetWeather.stale', {
            time: formatDisplayDateTime(lastUpdatedMs, { use24Hour: use24h }),
          })}
        </div>
      ) : null}
    </div>
  );
}
