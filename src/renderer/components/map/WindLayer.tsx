import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { Marker, useMap, useMapEvents } from 'react-leaflet';

import {
  windArrowDelta,
  windFromDirectionToArrowRad,
} from '@/renderer/lib/map/internetWeatherRender';
import type { WeatherGrid, WeatherWindUnit } from '@/shared/weather/types';
import { convertWind, roundDisplay } from '@/shared/weather/units';

function windColor(ms: number): string {
  if (ms < 2) return '#60a5fa';
  if (ms < 6) return '#4ade80';
  if (ms < 12) return '#fbbf24';
  return '#f87171';
}

export function WindLayer({
  grid,
  unit,
}: {
  grid: WeatherGrid;
  unit: WeatherWindUnit;
}): React.JSX.Element | null {
  const map = useMap();
  const canvasRef = useRef<L.ImageOverlay | null>(null);

  const points = useMemo(
    () =>
      grid.points.filter(
        (p) =>
          p.windSpeedMs != null &&
          Number.isFinite(p.windSpeedMs) &&
          p.windDirectionDeg != null &&
          Number.isFinite(p.windDirectionDeg),
      ),
    [grid.points],
  );

  const redraw = () => {
    if (canvasRef.current) {
      map.removeLayer(canvasRef.current);
      canvasRef.current = null;
    }
    if (points.length === 0) return;
    const size = map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(2048, Math.max(1, Math.floor(size.x * dpr)));
    const h = Math.min(2048, Math.max(1, Math.floor(size.y * dpr)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    for (const p of points) {
      const pt = map.latLngToContainerPoint([p.latitude, p.longitude]);
      const speed = p.windSpeedMs!;
      const dir = p.windDirectionDeg!;
      const rotationRad = windFromDirectionToArrowRad(dir);
      const len = Math.min(40, Math.max(12, speed * 3));
      const { dx, dy } = windArrowDelta(rotationRad, len);
      ctx.strokeStyle = windColor(speed);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x + dx, pt.y + dy);
      ctx.stroke();
      // arrowhead
      const ah = 6;
      const left = rotationRad + (2.5 * Math.PI) / 3;
      const right = rotationRad - (2.5 * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(pt.x + dx, pt.y + dy);
      ctx.lineTo(pt.x + dx + Math.sin(left) * ah, pt.y + dy - Math.cos(left) * ah);
      ctx.lineTo(pt.x + dx + Math.sin(right) * ah, pt.y + dy - Math.cos(right) * ah);
      ctx.closePath();
      ctx.fillStyle = windColor(speed);
      ctx.fill();

      if (p.windGustMs != null && p.windGustMs >= speed * 1.5) {
        const glen = Math.min(40, Math.max(12, p.windGustMs * 3));
        const { dx: gdx, dy: gdy } = windArrowDelta(rotationRad, glen);
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x + gdx, pt.y + gdy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    const overlay = L.imageOverlay(canvas.toDataURL('image/png'), map.getBounds(), {
      opacity: 1,
      pane: 'weather-wind',
      interactive: false,
    });
    overlay.addTo(map);
    canvasRef.current = overlay;
  };

  useMapEvents({ moveend: redraw, zoomend: redraw });
  useEffect(() => {
    redraw();
    return () => {
      if (canvasRef.current) {
        map.removeLayer(canvasRef.current);
        canvasRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, map, points]);

  const zoom = map.getZoom();
  if (zoom < 9) return null;
  const center = map.getCenter();
  const nearest = [...points]
    .sort(
      (a, b) =>
        Math.hypot(a.latitude - center.lat, a.longitude - center.lng) -
        Math.hypot(b.latitude - center.lat, b.longitude - center.lng),
    )
    .slice(0, 20);

  return (
    <>
      {nearest.map((p) => {
        const display = convertWind(p.windSpeedMs, unit);
        if (display == null) return null;
        const label = String(roundDisplay(display, 0));
        const icon = L.divIcon({
          className: '',
          html: `<div style="color:#e2e8f0;font-size:10px;text-shadow:0 0 3px #000">${label}</div>`,
        });
        return (
          <Marker
            key={`w-${p.latitude},${p.longitude}`}
            position={[p.latitude, p.longitude]}
            icon={icon}
            interactive={false}
            pane="weather-wind"
          />
        );
      })}
    </>
  );
}
