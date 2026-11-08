import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { Marker, useMap, useMapEvents } from 'react-leaflet';

import { sensorColorForValue } from '@/renderer/lib/environmentSensorDisplay';
import { idwTemperature } from '@/renderer/lib/map/internetWeatherRender';
import type { WeatherGrid, WeatherTempUnit } from '@/shared/weather/types';
import { convertTemp, roundDisplay, tempUnitLabel } from '@/shared/weather/units';

export function TemperatureLayer({
  grid,
  unit,
}: {
  grid: WeatherGrid;
  unit: WeatherTempUnit;
}): React.JSX.Element | null {
  const map = useMap();
  const overlayRef = useRef<L.ImageOverlay | null>(null);

  const validPoints = useMemo(
    () =>
      grid.points
        .filter((p) => p.temperatureC != null && Number.isFinite(p.temperatureC))
        .map((p) => ({ lat: p.latitude, lon: p.longitude, value: p.temperatureC! })),
    [grid.points],
  );

  const redraw = () => {
    if (overlayRef.current) {
      map.removeLayer(overlayRef.current);
      overlayRef.current = null;
    }
    if (validPoints.length < 2) return;

    const size = map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(2048, Math.max(1, Math.floor(size.x * dpr)));
    const h = Math.min(2048, Math.max(1, Math.floor(size.y * dpr)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    const bounds = map.getBounds();
    const step = 2;
    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const latlng = map.containerPointToLatLng([px / dpr, py / dpr]);
        const v = idwTemperature(latlng.lat, latlng.lng, validPoints);
        if (v == null) continue;
        const color = sensorColorForValue('temperature', v);
        const r = Number.parseInt(color.slice(1, 3), 16);
        const g = Number.parseInt(color.slice(3, 5), 16);
        const b = Number.parseInt(color.slice(5, 7), 16);
        for (let dy = 0; dy < step && py + dy < h; dy++) {
          for (let dx = 0; dx < step && px + dx < w; dx++) {
            const i = ((py + dy) * w + (px + dx)) * 4;
            img.data[i] = r;
            img.data[i + 1] = g;
            img.data[i + 2] = b;
            img.data[i + 3] = Math.round(0.35 * 255);
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    const overlay = L.imageOverlay(canvas.toDataURL('image/png'), bounds, {
      opacity: 1,
      pane: 'weather-temp',
      interactive: false,
    });
    overlay.addTo(map);
    overlayRef.current = overlay;
  };

  useMapEvents({
    moveend: redraw,
    zoomend: redraw,
  });

  useEffect(() => {
    redraw();
    return () => {
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, map, validPoints]);

  const zoom = map.getZoom();
  if (zoom < 8 || validPoints.length === 0) return null;

  const center = map.getCenter();
  const nearest = [...validPoints]
    .sort(
      (a, b) =>
        Math.hypot(a.lat - center.lat, a.lon - center.lng) -
        Math.hypot(b.lat - center.lat, b.lon - center.lng),
    )
    .slice(0, 20);

  return (
    <>
      {nearest.map((p) => {
        const display = convertTemp(p.value, unit);
        if (display == null) return null;
        const label = `${roundDisplay(display, 0)}${tempUnitLabel(unit)}`;
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#11151c;color:#e2e8f0;padding:1px 4px;border-radius:4px;font-size:10px;line-height:1.2;white-space:nowrap">${label}</div>`,
        });
        return (
          <Marker
            key={`${p.lat},${p.lon}`}
            position={[p.lat, p.lon]}
            icon={icon}
            interactive={false}
            pane="weather-temp"
            title={label}
          />
        );
      })}
    </>
  );
}
