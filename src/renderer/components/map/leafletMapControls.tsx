import L from 'leaflet';
import { Crosshair, PARENT_HOVER_ATTR } from 'lucide-react-motion';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, useMap } from 'react-leaflet';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import { useMapViewportStore } from '@/renderer/stores/mapViewportStore';

import { useToast } from '../Toast';

const MAP_STYLE_ID = 'map-styles';
const LORA_MAP_STYLE_ID = 'map-lora-panel-styles';

/** Shared Leaflet control styles (locate button) for Meshtastic/MeshCore/Reticulum maps. */
export function ensureMapStyles(): void {
  if (document.getElementById(MAP_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MAP_STYLE_ID;
  style.textContent = `
    .leaflet-locate-control a {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      background: #ffffff;
      color: #52525b;
      cursor: pointer;
      border: none;
      outline: none;
    }
    .leaflet-locate-control a:hover {
      background: #f4f4f5;
      color: #000000;
    }
    .leaflet-locate-control a.locating {
      color: #3b82f6;
    }
  `;
  document.head.appendChild(style);
}

/** LoRa map panel styles (anomaly halos, dark node popups) — Meshtastic/MeshCore MapPanel only. */
export function ensureLoRaMapPanelStyles(): void {
  ensureMapStyles();
  if (document.getElementById(LORA_MAP_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = LORA_MAP_STYLE_ID;
  style.textContent = `
    @keyframes anomaly-pulse {
      0%, 100% { opacity: 0.75; }
      50%       { opacity: 0.15; }
    }
    .anomaly-halo-warning {
      animation: anomaly-pulse 2s ease-in-out infinite;
      pointer-events: none !important;
    }
    .anomaly-halo-error {
      animation: anomaly-pulse 1.4s ease-in-out infinite;
      pointer-events: none !important;
    }
    html[data-reduce-motion='true'] .anomaly-halo-warning,
    html[data-reduce-motion='true'] .anomaly-halo-error {
      animation: none !important;
      opacity: 0.75 !important;
    }
    .leaflet-popup.map-node-popup .leaflet-popup-content-wrapper {
      background: #0f172a;
      border: 1px solid #334155;
      color: #e5e7eb;
      border-radius: 0.75rem;
      padding: 0;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    }
    .leaflet-popup.map-node-popup .leaflet-popup-content {
      margin: 0;
      min-width: 280px;
      max-width: 340px;
      max-height: 70vh;
      overflow: hidden;
    }
    .leaflet-popup.map-node-popup .leaflet-popup-content > div {
      max-height: 70vh;
      overflow-y: auto;
    }
    .leaflet-popup.map-node-popup .leaflet-popup-tip {
      background: #0f172a;
    }
    .leaflet-popup.map-node-popup .leaflet-popup-close-button {
      color: #9ca3af !important;
    }
    .leaflet-popup.map-node-popup .leaflet-popup-close-button:hover {
      color: #e5e7eb !important;
    }
  `;
  document.head.appendChild(style);
}

export function LocateMeControl({
  onLocateMe,
}: {
  onLocateMe?: () => Promise<{ lat: number; lon: number } | null>;
}) {
  const map = useMap();
  const [loading, setLoading] = useState(false);
  const [locatedPos, setLocatedPos] = useState<[number, number] | null>(null);
  const { addToast } = useToast();
  const { t } = useTranslation();
  const locateTrigger = useParentIconTrigger();

  const handleLocate = async () => {
    setLoading(true);
    try {
      if (onLocateMe) {
        const pos = await onLocateMe();
        if (pos) {
          const coords: [number, number] = [pos.lat, pos.lon];
          setLocatedPos(coords);
          map.flyTo(coords, 16);
        } else {
          addToast(t('mapPanel.locationUnavailable'), 'error');
        }
        return;
      }
      const result = await window.electronAPI.getGpsFix();
      if ('status' in result && result.status === 'error') {
        addToast(result.message, 'error');
        return;
      }
      if (!('lat' in result) || !('lon' in result)) {
        addToast(t('mapPanel.locationRequestFailed'), 'error');
        return;
      }
      const coords: [number, number] = [result.lat, result.lon];
      setLocatedPos(coords);
      map.flyTo(coords, 16);
    } catch (e) {
      console.error('[LocateMeControl] getGpsFix failed: ' + errLikeToLogString(e));
      addToast(t('mapPanel.locationRequestFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="leaflet-top leaflet-left" style={{ pointerEvents: 'none' }}>
        <div
          className="leaflet-control leaflet-bar leaflet-locate-control"
          style={{ marginTop: '80px', pointerEvents: 'auto' }}
        >
          <button
            type="button"
            title={t('mapPanel.showMyLocation')}
            aria-label={t('mapPanel.showMyLocation')}
            aria-busy={loading}
            {...{ [PARENT_HOVER_ATTR]: '' }}
            className={`leaflet-bar-part cursor-pointer border-0 bg-white p-0 ${loading ? 'locating' : ''}`}
            onClick={() => {
              void handleLocate();
            }}
          >
            <Crosshair
              aria-hidden
              className="h-4 w-4 text-gray-700"
              trigger={locateTrigger}
              size={16}
            />
          </button>
        </div>
      </div>
      {locatedPos ? (
        <CircleMarker
          center={locatedPos}
          radius={8}
          pathOptions={{ color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }}
        />
      ) : null}
    </>
  );
}

/** Basemap picker shared by protocol map panels. */
export function MapBasemapControl() {
  const { t } = useTranslation();
  const layersPanelOpen = useMapLayerStore((s) => s.layersPanelOpen);
  const setLayersPanelOpen = useMapLayerStore((s) => s.setLayersPanelOpen);
  const basemapId = useMapLayerStore((s) => s.basemapId);
  const setBasemapId = useMapLayerStore((s) => s.setBasemapId);

  return (
    <div className="flex w-52 flex-col items-stretch gap-2">
      <button
        type="button"
        aria-label={t('mapPanel.layerControlsAria')}
        aria-expanded={layersPanelOpen}
        className="bg-deep-black/80 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-200 backdrop-blur-sm transition-colors hover:border-gray-500"
        onClick={() => {
          setLayersPanelOpen(!layersPanelOpen);
        }}
      >
        {t('mapPanel.layerControls')}
      </button>
      {layersPanelOpen ? (
        <div className="bg-deep-black/90 w-52 space-y-3 rounded-lg border border-gray-700 p-3 text-gray-200 shadow-lg backdrop-blur-sm">
          <div className="space-y-1">
            <div className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
              {t('mapPanel.basemapHeading')}
            </div>
            <select
              aria-label={t('mapPanel.basemapSelectAria')}
              className="bg-secondary-dark w-full rounded border border-gray-600 px-2 py-1 text-xs text-gray-200"
              value={basemapId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'dark' || v === 'osm') setBasemapId(v);
              }}
            >
              <option value="dark">{t('mapPanel.basemapDark')}</option>
              <option value="osm">{t('mapPanel.basemapOsm')}</option>
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const VIEWPORT_EPS = 1e-6;

export function MapViewportSaver({ hasAnyPositions }: { hasAnyPositions: boolean }) {
  const map = useMap();
  const setViewport = useMapViewportStore((s) => s.setViewport);
  useEffect(() => {
    if (!hasAnyPositions) return;
    const onMoveEnd = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const next = { center: [center.lat, center.lng] as [number, number], zoom };
      const current = useMapViewportStore.getState().viewport;
      if (
        current?.zoom === next.zoom &&
        Math.abs(current.center[0] - next.center[0]) < VIEWPORT_EPS &&
        Math.abs(current.center[1] - next.center[1]) < VIEWPORT_EPS
      ) {
        return;
      }
      setViewport(next);
    };
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('moveend', onMoveEnd);
    };
  }, [map, setViewport, hasAnyPositions]);
  return null;
}

export function MapResizeInvalidator({ active }: { active: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const id = window.requestAnimationFrame(() => {
      map.invalidateSize();
    });
    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [active, map]);
  return null;
}

export function flyMapToBounds(
  map: L.Map,
  points: L.LatLngExpression[],
  options?: { padding?: [number, number]; maxZoom?: number; minZoom?: number },
): void {
  if (points.length === 0) {
    map.setView([20, 0], 2);
    return;
  }
  if (points.length === 1) {
    map.setView(points[0], options?.maxZoom ?? 8);
    return;
  }
  map.fitBounds(L.latLngBounds(points), {
    padding: options?.padding ?? [48, 48],
    maxZoom: options?.maxZoom ?? 12,
  });
}
