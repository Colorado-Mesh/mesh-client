import L from 'leaflet';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, Marker, Tooltip } from 'react-leaflet';

import { useNowMs } from '@/renderer/hooks/useNowMs';
import { formatDisplayDateTime } from '@/renderer/lib/formatDisplayTime';
import {
  forecastAreaColor,
  forecastAreaRadiusMeters,
  forecastDisplayTemp,
} from '@/renderer/lib/weatherForecastArea';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';
import {
  selectActiveForecasts,
  useWeatherForecastStore,
  type WeatherForecastEntry,
} from '@/renderer/stores/weatherForecastStore';
import type { MeshProtocol } from '@/shared/meshProtocol';

/** Dark pill behind the temperature label (canvas/divIcon cannot read CSS custom properties). */
const LABEL_BG = '#11151c';

const PROTOCOL_NAME_KEYS: Readonly<Record<MeshProtocol, string>> = {
  meshtastic: 'weatherForecast.protocol.meshtastic',
  meshcore: 'weatherForecast.protocol.meshcore',
  reticulum: 'weatherForecast.protocol.reticulum',
};

export interface WeatherForecastLayerProps {
  onSenderClick?: (protocol: MeshProtocol, senderId: number) => void;
}

function useForecastTitle(entry: WeatherForecastEntry): string {
  const { t } = useTranslation();
  if (entry.placeLabel) return entry.placeLabel;
  if (entry.positionSource === 'requester') {
    return entry.requesterName
      ? t('weatherForecast.nearRequester', { name: entry.requesterName })
      : t('weatherForecast.nearRequesterUnknown');
  }
  return t('weatherForecast.nearSender', {
    name: entry.senderName ?? t('weatherForecast.unknownSender'),
  });
}

const ForecastArea = memo(function ForecastArea({
  entry,
  onSenderClick,
}: {
  entry: WeatherForecastEntry;
  onSenderClick?: WeatherForecastLayerProps['onSenderClick'];
}) {
  const { t } = useTranslation();
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const title = useForecastTitle(entry);
  const color = forecastAreaColor(entry);
  const temp = forecastDisplayTemp(entry);
  const tempText = temp
    ? t(temp.unit === 'C' ? 'sensorLayer.valueTempC' : 'sensorLayer.valueTempF', {
        value: Math.round(temp.value),
      })
    : null;
  const radius =
    entry.positionSource === 'requester' || entry.positionSource === 'senderApprox'
      ? forecastAreaRadiusMeters(undefined)
      : forecastAreaRadiusMeters(entry.population);
  const ariaLabel = tempText
    ? t('weatherForecast.areaAria', { place: title, temp: tempText, period: entry.period })
    : t('weatherForecast.areaAriaNoTemp', { place: title, period: entry.period });
  const protocolName = t(PROTOCOL_NAME_KEYS[entry.protocol]);
  const sender = entry.senderName ?? t('weatherForecast.unknownSender');
  const eventHandlers = useMemo(
    () =>
      onSenderClick
        ? {
            click: () => {
              onSenderClick(entry.protocol, entry.senderId);
            },
          }
        : undefined,
    [onSenderClick, entry.protocol, entry.senderId],
  );
  const labelIcon = useMemo(
    () =>
      tempText
        ? L.divIcon({
            // Only the localized numeric temperature is interpolated; place names stay out of HTML.
            html: `<span style="display:inline-flex;align-items:center;justify-content:center;padding:1px 6px;border-radius:9999px;background:${LABEL_BG};border:2px solid ${color};color:${color};font-size:12px;font-weight:700;line-height:1.2;white-space:nowrap;">${tempText.replace(/[^0-9°.,\-−CF ]/g, '')}</span>`,
            className: '',
            iconSize: [52, 22],
            iconAnchor: [26, 11],
          })
        : null,
    [tempText, color],
  );

  const tooltip = (
    <Tooltip direction="top" sticky>
      <div className="font-medium">{title}</div>
      {entry.resolvedLabel && entry.resolvedLabel !== entry.placeLabel ? (
        <div className="opacity-80">{entry.resolvedLabel}</div>
      ) : null}
      {entry.segments.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
      {entry.highLow ? (
        <div>
          {t('weatherForecast.highLow', { high: entry.highLow.high, low: entry.highLow.low })}
        </div>
      ) : null}
      {entry.hasAlerts ? <div>{t('weatherForecast.alerts')}</div> : null}
      {entry.issuedTruncated ? (
        <div className="opacity-80">
          {t('weatherForecast.received', {
            when: formatDisplayDateTime(entry.receivedAt, { use24Hour: use24HourTime }),
          })}
        </div>
      ) : entry.issuedAt ? (
        <div className="opacity-80">{t('weatherForecast.issued', { when: entry.issuedAt })}</div>
      ) : null}
      {entry.positionSource === 'senderApprox' ? (
        <div className="opacity-80">{t('weatherForecast.positionApprox')}</div>
      ) : null}
      {entry.positionSource === 'requester' ? (
        <div className="opacity-80">{t('weatherForecast.positionRequester')}</div>
      ) : null}
      <div className="opacity-80">
        {t('weatherForecast.via', { sender, protocol: protocolName })}
      </div>
    </Tooltip>
  );

  return (
    <>
      <Circle
        center={[entry.lat, entry.lon]}
        radius={radius}
        pathOptions={{
          color,
          fillColor: color,
          fillOpacity: 0.15,
          weight: 2,
          dashArray: entry.positionSource === 'senderApprox' ? '6 6' : undefined,
        }}
        eventHandlers={eventHandlers}
      >
        {tooltip}
      </Circle>
      {labelIcon ? (
        <Marker
          position={[entry.lat, entry.lon]}
          icon={labelIcon}
          title={ariaLabel}
          eventHandlers={eventHandlers}
        />
      ) : null}
    </>
  );
});

/**
 * Forecasts from marked weather senders on Meshtastic and MeshCore, drawn as translucent areas
 * colored by temperature. Shared by every map.
 */
export function WeatherForecastLayer({ onSenderClick }: WeatherForecastLayerProps) {
  const entries = useWeatherForecastStore((s) => s.entries);
  const nowMs = useNowMs();
  const forecasts = useMemo(
    () => (nowMs > 0 ? selectActiveForecasts(entries, nowMs) : Object.values(entries)),
    [entries, nowMs],
  );
  return (
    <>
      {forecasts.map((entry) => (
        <ForecastArea key={entry.key} entry={entry} onSenderClick={onSenderClick} />
      ))}
    </>
  );
}
