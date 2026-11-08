import { useTranslation } from 'react-i18next';

import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import { tempUnitLabel } from '@/shared/weather/units';

import { MAP_OVERLAY_PANEL_CLASS } from './mapControlClasses';

export function WeatherLegend(): React.JSX.Element | null {
  const { t } = useTranslation();
  const enabled = useInternetWeatherStore((s) => s.enabled);
  const tempUnit = useInternetWeatherStore((s) => s.tempUnit);
  const showTemp = useMapLayerStore((s) => s.showWeatherTemperature);
  const showWind = useMapLayerStore((s) => s.showWeatherWind);
  const showRadar = useMapLayerStore((s) => s.showRadar);

  if (!enabled || (!showTemp && !showWind && !showRadar)) return null;

  const unit = tempUnitLabel(tempUnit);
  const ticks =
    tempUnit === 'f'
      ? [-4, 32, 68, 104].map((v) => `${v}${unit}`)
      : [-20, 0, 20, 40].map((v) => `${v}${unit}`);

  return (
    <div
      className={`${MAP_OVERLAY_PANEL_CLASS} absolute bottom-36 left-3 z-[500] max-w-[14rem] space-y-1`}
      aria-label={t('internetWeather.legend')}
    >
      {showTemp ? (
        <div>
          <div className="text-ink-300 text-2xs font-medium">
            {t('internetWeather.layerTemperature')}
          </div>
          <div
            className="rounded-control mt-1 h-2 w-full"
            style={{
              background: 'linear-gradient(90deg,#60a5fa,#22d3ee,#4ade80,#fbbf24,#f87171)',
            }}
            aria-hidden
          />
          <div className="text-ink-400 text-2xs mt-0.5 flex justify-between">
            {ticks.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
        </div>
      ) : null}
      {showWind ? (
        <div className="text-ink-400 text-2xs">{t('internetWeather.windLegend')}</div>
      ) : null}
      {showRadar ? (
        <div className="text-ink-400 text-2xs">{t('internetWeather.radarLegend')}</div>
      ) : null}
    </div>
  );
}
