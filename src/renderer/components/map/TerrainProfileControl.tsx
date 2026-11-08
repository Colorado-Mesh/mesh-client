import type { LeafletMouseEvent } from 'leaflet';
import { DomEvent } from 'leaflet';
import { Mountain } from 'lucide-react-motion';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, Polyline, useMap } from 'react-leaflet';

import { useMapToolStore } from '@/renderer/stores/mapToolStore';
import type { ElevationFrequencyMhz } from '@/shared/elevation/types';

import { MAP_CONTROL_CLASS } from './mapControlClasses';

const PROFILE_LINE_COLOR = '#38bdf8'; // sky-400 — matches chart LOS stroke

const FREQUENCIES: ElevationFrequencyMhz[] = [915, 868, 433];

/** Leaflet-side terrain profile tool (endpoints + path). Chart lives outside MapContainer. */
export function TerrainProfileControl(): React.JSX.Element {
  const map = useMap();
  const { t } = useTranslation();
  const controlRef = useRef<HTMLDivElement>(null);
  const profileActive = useMapToolStore((s) => s.profileActive);
  const setProfileActive = useMapToolStore((s) => s.setProfileActive);
  const endpoints = useMapToolStore((s) => s.profileEndpoints);
  const addProfileEndpoint = useMapToolStore((s) => s.addProfileEndpoint);
  const clearProfileEndpoints = useMapToolStore((s) => s.clearProfileEndpoints);
  const frequencyMhz = useMapToolStore((s) => s.profileFrequencyMhz);
  const setFrequencyMhz = useMapToolStore((s) => s.setProfileFrequencyMhz);
  const setMeasureActive = useMapToolStore((s) => s.setMeasureActive);

  useEffect(() => {
    const el = controlRef.current;
    if (!el) return;
    DomEvent.disableClickPropagation(el);
    DomEvent.disableScrollPropagation(el);
    return () => {
      DomEvent.off(el);
    };
  }, []);

  // Match MeasureControl: leaving the map (protocol switch unmounts MapPanel)
  // must not leave profile clicks stealing node/map selection.
  useEffect(() => {
    return () => {
      setProfileActive(false);
    };
  }, [setProfileActive]);

  useEffect(() => {
    if (!profileActive) return;
    const onClick = (e: LeafletMouseEvent) => {
      addProfileEndpoint({ lat: e.latlng.lat, lon: e.latlng.lng });
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [profileActive, map, addProfileEndpoint]);

  const toggle = () => {
    if (profileActive) {
      setProfileActive(false);
      clearProfileEndpoints();
      return;
    }
    setMeasureActive(false);
    clearProfileEndpoints();
    setProfileActive(true);
  };

  return (
    <>
      <div className="leaflet-top leaflet-left" style={{ pointerEvents: 'none' }}>
        <div
          ref={controlRef}
          className="leaflet-control flex flex-col items-start gap-1"
          style={{ marginTop: '168px', pointerEvents: 'auto' }}
        >
          <button
            type="button"
            aria-pressed={profileActive}
            aria-label={t(
              profileActive
                ? 'mapPanel.terrainProfile.stopAria'
                : 'mapPanel.terrainProfile.startAria',
            )}
            title={t(
              profileActive
                ? 'mapPanel.terrainProfile.stopAria'
                : 'mapPanel.terrainProfile.startAria',
            )}
            className={MAP_CONTROL_CLASS}
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            <Mountain aria-hidden className="h-3.5 w-3.5" />
            {t('mapPanel.terrainProfile.button')}
          </button>
          {profileActive ? (
            <div
              role="status"
              className="bg-deep-black/90 border-ink-700 text-ink-100 flex flex-col gap-1 rounded-lg border px-2.5 py-1.5 text-xs"
            >
              <span>
                {endpoints.length < 2
                  ? t('mapPanel.terrainProfile.hint')
                  : t('mapPanel.terrainProfile.ready')}
              </span>
              <label className="text-ink-300 flex items-center gap-1">
                <span>{t('mapPanel.terrainProfile.frequency')}</span>
                <select
                  className="bg-ink-900 border-ink-600 rounded-control border px-1 py-0.5 text-xs"
                  aria-label={t('mapPanel.terrainProfile.frequencyAria')}
                  value={frequencyMhz}
                  onChange={(e) => {
                    setFrequencyMhz(Number(e.target.value) as ElevationFrequencyMhz);
                  }}
                >
                  {FREQUENCIES.map((mhz) => (
                    <option key={mhz} value={mhz}>
                      {mhz} MHz
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </div>
      {profileActive && endpoints.length >= 2 ? (
        <Polyline
          positions={endpoints.map((p) => [p.lat, p.lon] as [number, number])}
          pathOptions={{ color: PROFILE_LINE_COLOR, weight: 3, dashArray: '4 6' }}
        />
      ) : null}
      {profileActive
        ? endpoints.map((p, i) => (
            <CircleMarker
              key={`profile-${i}-${p.lat}-${p.lon}`}
              center={[p.lat, p.lon]}
              radius={5}
              pathOptions={{ color: PROFILE_LINE_COLOR, fillOpacity: 1, weight: 1 }}
            />
          ))
        : null}
    </>
  );
}
