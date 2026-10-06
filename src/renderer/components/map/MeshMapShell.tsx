import 'leaflet/dist/leaflet.css';

import { type ReactNode, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';

import {
  DEFAULT_MAP_BASEMAP_ID,
  MAP_BASEMAPS,
  MAP_MAX_ZOOM,
  meshTilesAvailable,
} from '@/renderer/lib/mapBasemapUtils';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import { useMapViewportStore } from '@/renderer/stores/mapViewportStore';
import type { MeshProtocol } from '@/shared/meshProtocol';

import { IncidentMarkersLayer, MeasureControl, MgrsGridLayer } from './emcommMapLayers';
import {
  ensureMapStyles,
  flyMapToBounds,
  LocateMeControl,
  MapResizeInvalidator,
  MapViewportSaver,
} from './leafletMapControls';
import { MapLayerControl } from './MapLayerControl';
import { WeatherForecastLayer } from './WeatherForecastLayer';

/**
 * How the map frames its points on first mount when no viewport was saved.
 * - `firstPoint`: center on the first point (else `fallbackPoint`, else `defaultCenter`) at `defaultZoom`.
 * - `bounds`: fit all points (world view when empty).
 */
export interface MeshMapFit {
  mode: 'firstPoint' | 'bounds';
  points: [number, number][];
  fallbackPoint?: [number, number] | null;
  shouldFitOnMount: boolean;
}

function MapFitter({
  fit,
  defaultCenter,
  defaultZoom,
}: {
  fit: MeshMapFit;
  defaultCenter: [number, number];
  defaultZoom: number;
}) {
  const map = useMap();
  const hasPerformedInitialFitRef = useRef(false);
  const { mode, points, fallbackPoint, shouldFitOnMount } = fit;
  useEffect(() => {
    if (!shouldFitOnMount || hasPerformedInitialFitRef.current) return;
    hasPerformedInitialFitRef.current = true;
    if (mode === 'bounds') {
      flyMapToBounds(map, points);
      return;
    }
    map.setView(points[0] ?? fallbackPoint ?? defaultCenter, defaultZoom);
  }, [map, mode, points, fallbackPoint, shouldFitOnMount, defaultCenter, defaultZoom]);
  return null;
}

/** Flies to `mapViewportStore.pendingFocus` ("show on map" requests from other panels). */
function MapFocusController() {
  const map = useMap();
  const pendingFocus = useMapViewportStore((s) => s.pendingFocus);
  const clearPendingFocus = useMapViewportStore((s) => s.clearPendingFocus);

  useEffect(() => {
    if (!pendingFocus) return;
    const { lat, lon, zoom = 14 } = pendingFocus;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      clearPendingFocus();
      return;
    }
    map.flyTo([lat, lon], zoom, { duration: 0.5 });
    clearPendingFocus();
  }, [pendingFocus, map, clearPendingFocus]);

  return null;
}

export interface MeshMapShellProps {
  ariaLabel: string;
  /** Sizing classes for the outer frame (e.g. `h-full min-h-[500px]`). */
  frameClassName: string;
  initialCenter: [number, number];
  initialZoom: number;
  defaultCenter: [number, number];
  defaultZoom: number;
  fit: MeshMapFit;
  hasAnyPositions: boolean;
  onLocateMe?: () => Promise<{ lat: number; lon: number } | null>;
  /** Top-right controls rendered above the layers button (status chip). */
  controlsBefore?: ReactNode;
  /** Top-right controls rendered below the layers button. */
  controlsAfter?: ReactNode;
  /** The map's own layer toggles, shown above the global rows in the layers panel. */
  layerRows?: ReactNode;
  /** Leaflet children mounted before the tiles (custom panes, fly controllers). */
  beforeTiles?: ReactNode;
  /** Overlay rendered over the map, outside Leaflet (empty states). */
  overlay?: ReactNode;
  /** Opens the sender of a forecast area (node detail); unset where senders cannot be shown. */
  onForecastSenderClick?: (protocol: MeshProtocol, senderId: number) => void;
  /** The map's own Leaflet layers. */
  children?: ReactNode;
}

/**
 * Map frame shared by the LoRa and Reticulum maps: container, basemap tiles, viewport persistence,
 * locate / measure / focus controls, the layers panel, and global overlays (incidents, MGRS, weather forecasts).
 */
export function MeshMapShell({
  ariaLabel,
  frameClassName,
  initialCenter,
  initialZoom,
  defaultCenter,
  defaultZoom,
  fit,
  hasAnyPositions,
  onLocateMe,
  controlsBefore,
  controlsAfter,
  layerRows,
  beforeTiles,
  overlay,
  onForecastSenderClick,
  children,
}: MeshMapShellProps) {
  const basemapId = useMapLayerStore((s) => s.basemapId);
  const showIncidents = useMapLayerStore((s) => s.showIncidents);
  const showMgrsGrid = useMapLayerStore((s) => s.showMgrsGrid);
  const showWeatherForecasts = useMapLayerStore((s) => s.showWeatherForecasts);
  const basemap = MAP_BASEMAPS[basemapId] ?? MAP_BASEMAPS[DEFAULT_MAP_BASEMAP_ID];

  useEffect(() => {
    ensureMapStyles();
  }, []);

  // `isolate` keeps Leaflet's panes (z 400 to 1000) and the z-[1000] controls inside the map, so a
  // dialog opened over this tab draws above them.
  return (
    <div
      className={`border-ink-700/50 relative isolate overflow-hidden rounded-lg border ${frameClassName}`}
      aria-label={ariaLabel}
    >
      <div className="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2">
        {controlsBefore}
        <MapLayerControl extraRows={layerRows} />
        {controlsAfter}
      </div>

      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        maxZoom={MAP_MAX_ZOOM}
        className="absolute inset-0"
        preferCanvas
      >
        <MapResizeInvalidator active />
        {beforeTiles}
        <MapViewportSaver hasAnyPositions={hasAnyPositions} />
        <MapFocusController />
        <MapFitter fit={fit} defaultCenter={defaultCenter} defaultZoom={defaultZoom} />
        <LocateMeControl onLocateMe={onLocateMe} />
        <MeasureControl />
        {meshTilesAvailable() && (
          <TileLayer
            key={basemapId}
            url={basemap.url}
            attribution={basemap.attribution}
            maxNativeZoom={basemap.maxNativeZoom}
            keepBuffer={1}
            updateWhenIdle
          />
        )}
        {showMgrsGrid ? <MgrsGridLayer /> : null}
        {showWeatherForecasts ? (
          <WeatherForecastLayer onSenderClick={onForecastSenderClick} />
        ) : null}
        {children}
        {showIncidents ? <IncidentMarkersLayer /> : null}
      </MapContainer>

      {overlay}
    </div>
  );
}
