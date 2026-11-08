import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popup, useMapEvents } from 'react-leaflet';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatDisplayDateTime } from '@/renderer/lib/formatDisplayTime';
import { isMapChromeClick } from '@/renderer/lib/map/isMapChromeClick';
import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import { useMapToolStore } from '@/renderer/stores/mapToolStore';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';
import { type WeatherPointForecast, WMO_WEATHER_CODES } from '@/shared/weather/types';
import {
  convertPrecip,
  convertTemp,
  convertWind,
  roundDisplay,
  tempUnitLabel,
} from '@/shared/weather/units';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; lat: number; lon: number }
  | { status: 'ready'; lat: number; lon: number; forecast: WeatherPointForecast }
  | { status: 'error'; lat: number; lon: number; offline?: boolean };

export function WeatherPopup(): React.JSX.Element | null {
  const { t } = useTranslation();
  const enabled = useInternetWeatherStore((s) => s.enabled);
  const tempUnit = useInternetWeatherStore((s) => s.tempUnit);
  const windUnit = useInternetWeatherStore((s) => s.windUnit);
  const precipUnit = useInternetWeatherStore((s) => s.precipUnit);
  const measureActive = useMapToolStore((s) => s.measureActive);
  const use24h = useTimeFormatStore((s) => s.use24HourTime);
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const draggedRef = useRef(false);

  useMapEvents({
    dragstart: () => {
      draggedRef.current = true;
    },
    dragend: () => {
      window.setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    },
    click: (e) => {
      if (!enabled || measureActive || draggedRef.current) return;
      if (isMapChromeClick(e.originalEvent)) return;
      const { lat, lng: lon } = e.latlng;
      setState({ status: 'loading', lat, lon });
      const api = window.electronAPI?.weather;
      if (!api) {
        setState({ status: 'error', lat, lon });
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setState({ status: 'error', lat, lon, offline: true });
        return;
      }
      void api
        .pointForecast({ lat, lon })
        .then((res) => {
          if (res.ok) setState({ status: 'ready', lat, lon, forecast: res.data });
          else setState({ status: 'error', lat, lon, offline: res.error.code === 'offline' });
        })
        .catch((err: unknown) => {
          console.warn('[WeatherPopup] ' + errLikeToLogString(err));
          setState({ status: 'error', lat, lon });
        });
    },
  });

  const close = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- close popup when master toggle turns off
      close();
    }
  }, [enabled, close]);

  if (state.status === 'idle') return null;
  const position: [number, number] = [state.lat, state.lon];

  return (
    <Popup position={position} eventHandlers={{ remove: close }}>
      <div
        className="text-ink-100 max-w-[320px] space-y-2 text-xs"
        role="dialog"
        aria-label={t('internetWeather.heading')}
      >
        <div className="text-ink-300 text-2xs">
          {t('internetWeather.coordinates', {
            lat: state.lat.toFixed(4),
            lon: state.lon.toFixed(4),
          })}
        </div>
        {state.status === 'loading' ? (
          <div className="text-ink-400">{t('internetWeather.loading')}</div>
        ) : null}
        {state.status === 'error' ? (
          <div className="space-y-1">
            <div>
              {state.offline ? t('internetWeather.offline') : t('internetWeather.loadFailed')}
            </div>
            <button
              type="button"
              className="text-bright-green underline"
              aria-label={t('internetWeather.retry')}
              onClick={() => {
                setState({ status: 'loading', lat: state.lat, lon: state.lon });
                void window.electronAPI.weather
                  .pointForecast({ lat: state.lat, lon: state.lon })
                  .then((res) => {
                    if (res.ok)
                      setState({
                        status: 'ready',
                        lat: state.lat,
                        lon: state.lon,
                        forecast: res.data,
                      });
                    else setState({ status: 'error', lat: state.lat, lon: state.lon });
                  });
              }}
            >
              {t('internetWeather.retry')}
            </button>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <ForecastBody
            forecast={state.forecast}
            tempUnit={tempUnit}
            windUnit={windUnit}
            precipUnit={precipUnit}
            use24h={use24h}
            t={t}
          />
        ) : null}
      </div>
    </Popup>
  );
}

function ForecastBody({
  forecast,
  tempUnit,
  windUnit,
  precipUnit,
  use24h,
  t,
}: {
  forecast: WeatherPointForecast;
  tempUnit: 'c' | 'f';
  windUnit: 'kmh' | 'mph' | 'ms' | 'kn';
  precipUnit: 'mm' | 'in';
  use24h: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): React.JSX.Element {
  const c = forecast.current;
  const codeKey =
    c?.weatherCode != null ? (WMO_WEATHER_CODES[c.weatherCode] ?? 'unknown') : 'unknown';
  const temp = convertTemp(c?.temperatureC ?? null, tempUnit);
  const feels = convertTemp(c?.apparentTemperatureC ?? null, tempUnit);
  const wind = convertWind(c?.windSpeedMs ?? null, windUnit);
  const gust = convertWind(c?.windGustMs ?? null, windUnit);
  const precip = convertPrecip(c?.precipitationMm ?? null, precipUnit);
  const hourly = forecast.hourly.slice(0, 24);
  const temps = hourly
    .map((h) => convertTemp(h.temperatureC, tempUnit))
    .filter((v): v is number => v != null);
  const maxPrecipProb = Math.max(0, ...hourly.map((h) => h.precipitationProbabilityPct ?? 0));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-title font-semibold">
          {temp != null ? `${roundDisplay(temp, 0)}${tempUnitLabel(tempUnit)}` : '—'}
        </span>
        <span>{t(`internetWeather.conditions.${codeKey}`)}</span>
      </div>
      {feels != null ? (
        <div className="text-ink-300">
          {t('internetWeather.feelsLike', {
            value: `${roundDisplay(feels, 0)}${tempUnitLabel(tempUnit)}`,
          })}
        </div>
      ) : null}
      <div className="text-ink-200 grid grid-cols-2 gap-1">
        {wind != null ? (
          <span>
            {t('internetWeather.wind', {
              dir: c?.windDirectionDeg != null ? `${roundDisplay(c.windDirectionDeg, 0)}°` : '—',
              value: `${roundDisplay(wind, 0)} ${t(
                windUnit === 'mph'
                  ? 'internetWeather.unitMph'
                  : windUnit === 'ms'
                    ? 'internetWeather.unitMs'
                    : windUnit === 'kn'
                      ? 'internetWeather.unitKn'
                      : 'internetWeather.unitKmh',
              )}`,
            })}
          </span>
        ) : null}
        {gust != null ? (
          <span>
            {t('internetWeather.gusts', {
              value: String(roundDisplay(gust, 0)),
            })}
          </span>
        ) : null}
        {c?.relativeHumidityPct != null ? (
          <span>
            {t('internetWeather.humidity', { value: roundDisplay(c.relativeHumidityPct, 0) })}
          </span>
        ) : null}
        {c?.pressureHpa != null ? (
          <span>{t('internetWeather.pressure', { value: roundDisplay(c.pressureHpa, 0) })}</span>
        ) : null}
        {precip != null ? (
          <span>
            {t('internetWeather.precip', {
              value: `${roundDisplay(precip, precipUnit === 'in' ? 2 : 1)} ${t(
                precipUnit === 'in' ? 'internetWeather.unitIn' : 'internetWeather.unitMm',
              )}`,
            })}
          </span>
        ) : null}
        {c?.cloudCoverPct != null ? (
          <span>
            {t('internetWeather.cloudCover', { value: roundDisplay(c.cloudCoverPct, 0) })}
          </span>
        ) : null}
      </div>
      <div className="text-ink-400 text-2xs">
        {t('internetWeather.updated', {
          time: formatDisplayDateTime(forecast.fetchedAtMs, { use24Hour: use24h }),
        })}
      </div>
      <div>
        <div className="text-ink-300 mb-1 font-medium">{t('internetWeather.next24h')}</div>
        <div className="text-ink-400 text-2xs">
          {temps.length > 0
            ? `${roundDisplay(Math.min(...temps), 0)}–${roundDisplay(Math.max(...temps), 0)}${tempUnitLabel(tempUnit)}, ${maxPrecipProb}%`
            : '—'}
        </div>
      </div>
      <div>
        <div className="text-ink-300 mb-1 font-medium">{t('internetWeather.next7d')}</div>
        <ul className="space-y-0.5">
          {forecast.daily.slice(0, 7).map((d) => {
            const hi = convertTemp(d.temperatureMaxC, tempUnit);
            const lo = convertTemp(d.temperatureMinC, tempUnit);
            const dCode =
              d.weatherCode != null ? (WMO_WEATHER_CODES[d.weatherCode] ?? 'unknown') : 'unknown';
            return (
              <li key={d.dateIso} className="flex justify-between gap-2">
                <span>{d.dateIso}</span>
                <span>{t(`internetWeather.conditions.${dCode}`)}</span>
                <span>
                  {hi != null ? roundDisplay(hi, 0) : '—'} /{' '}
                  {lo != null ? roundDisplay(lo, 0) : '—'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="text-muted text-2xs">{t('internetWeather.attribution')}</div>
    </div>
  );
}
