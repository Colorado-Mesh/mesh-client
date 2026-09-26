import type { LeafletMouseEvent } from 'leaflet';
import { Ruler } from 'lucide-react-motion';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, Polyline, Rectangle, Tooltip, useMap } from 'react-leaflet';

import { type LatLon, polylineLengthKm } from '@/renderer/lib/map/measureMath';
import {
  type MgrsGridSquare,
  mgrsSquaresInBbox,
  pickMgrsPrecisionForBbox,
} from '@/renderer/lib/map/mgrsGrid';
import type { EmergencyIncident } from '@/renderer/lib/mecp/incidentTypes';
import { useIncidentStore } from '@/renderer/stores/incidentStore';

import { MAP_CONTROL_CLASS } from './mapControlClasses';

/** Labels stay readable only when few squares are on screen. */
const MGRS_LABEL_MAX_SQUARES = 60;
const KM_TO_MI = 0.621371;

const MGRS_LINE_COLOR = '#a1a1aa';
const MEASURE_LINE_COLOR = '#facc15';
const INCIDENT_SEVERITY_COLORS: Record<number, string> = {
  0: '#dc2626',
  1: '#ea580c',
  2: '#d97706',
  3: '#2563eb',
};

export function incidentMarkersFrom(
  incidents: Record<string, EmergencyIncident>,
): (EmergencyIncident & { lat: number; lon: number })[] {
  return Object.values(incidents).filter(
    (inc): inc is EmergencyIncident & { lat: number; lon: number } =>
      inc.status !== 'resolved' &&
      typeof inc.lat === 'number' &&
      typeof inc.lon === 'number' &&
      Number.isFinite(inc.lat) &&
      Number.isFinite(inc.lon),
  );
}

/** Unresolved incidents with coordinates (message or last-known sender position). */
export function IncidentMarkersLayer() {
  const { t } = useTranslation();
  const incidents = useIncidentStore((s) => s.incidents);
  const markers = useMemo(() => incidentMarkersFrom(incidents), [incidents]);
  if (markers.length === 0) return null;
  return (
    <>
      {markers.map((inc) => {
        const color = INCIDENT_SEVERITY_COLORS[inc.severity] ?? INCIDENT_SEVERITY_COLORS[3];
        return (
          <CircleMarker
            key={`incident-${inc.id}`}
            center={[inc.lat, inc.lon]}
            radius={11}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.35,
              weight: 3,
              ...(inc.isDrill ? { dashArray: '4 4' } : {}),
            }}
          >
            <Tooltip direction="top">
              {t(inc.isDrill ? 'mapPanel.incidentMarkerDrill' : 'mapPanel.incidentMarker', {
                sender: inc.senderName,
                codes: inc.codes.join(' '),
              })}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

/** MGRS squares for the current viewport at the finest precision under the square cap. */
export function MgrsGridLayer() {
  const map = useMap();
  const [squares, setSquares] = useState<MgrsGridSquare[]>([]);

  useEffect(() => {
    const update = () => {
      const b = map.getBounds();
      const south = b.getSouth();
      const west = b.getWest();
      const north = b.getNorth();
      const east = b.getEast();
      const precision = pickMgrsPrecisionForBbox(south, west, north, east);
      setSquares(precision == null ? [] : mgrsSquaresInBbox(south, west, north, east, precision));
    };
    map.whenReady(update);
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
    };
  }, [map]);

  const showLabels = squares.length <= MGRS_LABEL_MAX_SQUARES;
  return (
    <>
      {squares.map((sq) => (
        <Rectangle
          key={sq.label}
          bounds={sq.bounds}
          pathOptions={{ color: MGRS_LINE_COLOR, weight: 1, fill: false, interactive: false }}
        >
          {showLabels ? (
            <Tooltip permanent direction="center" className="mgrs-grid-label" opacity={0.8}>
              {sq.label}
            </Tooltip>
          ) : null}
        </Rectangle>
      ))}
    </>
  );
}

/** Click-to-measure polyline; toggling off clears the points. */
export function MeasureControl() {
  const map = useMap();
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState<LatLon[]>([]);

  useEffect(() => {
    if (!active) return;
    const onClick = (e: LeafletMouseEvent) => {
      setPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]]);
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [active, map]);

  const km = polylineLengthKm(points);
  return (
    <>
      <div className="leaflet-top leaflet-left" style={{ pointerEvents: 'none' }}>
        <div
          className="leaflet-control flex flex-col items-start gap-1"
          style={{ marginTop: '120px', pointerEvents: 'auto' }}
        >
          <button
            type="button"
            aria-pressed={active}
            aria-label={t(active ? 'mapPanel.measureStopAria' : 'mapPanel.measureStartAria')}
            title={t(active ? 'mapPanel.measureStopAria' : 'mapPanel.measureStartAria')}
            className={MAP_CONTROL_CLASS}
            onClick={() => {
              setActive((a) => !a);
              setPoints([]);
            }}
          >
            <Ruler aria-hidden className="h-3.5 w-3.5" />
            {t('mapPanel.measure')}
          </button>
          {active ? (
            <div
              role="status"
              className="bg-deep-black/90 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-100"
            >
              {points.length < 2
                ? t('mapPanel.measureHint')
                : t('mapPanel.measureTotal', {
                    km: km.toFixed(2),
                    mi: (km * KM_TO_MI).toFixed(2),
                  })}
            </div>
          ) : null}
        </div>
      </div>
      {active && points.length >= 2 ? (
        <Polyline
          positions={points.map(([lat, lon]) => [lat, lon] as [number, number])}
          pathOptions={{ color: MEASURE_LINE_COLOR, weight: 3, dashArray: '6 6' }}
        />
      ) : null}
      {active
        ? points.map(([lat, lon], i) => (
            <CircleMarker
              key={`measure-${i}`}
              center={[lat, lon]}
              radius={4}
              pathOptions={{ color: MEASURE_LINE_COLOR, fillOpacity: 1, weight: 1 }}
            />
          ))
        : null}
    </>
  );
}
