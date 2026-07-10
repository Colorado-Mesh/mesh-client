/* eslint-disable react-hooks/set-state-in-effect */
import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { ExternalLink, Globe, MapPin, RefreshCw } from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';

import {
  ensureMapStyles,
  flyMapToBounds,
  LocateMeControl,
  MapBasemapControl,
  MapResizeInvalidator,
  MapViewportSaver,
} from '@/renderer/components/map/leafletMapControls';
import { CHAT_SCROLL_END_THRESHOLD } from '@/renderer/lib/chatScrollUtils';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { readStoredStaticGps } from '@/renderer/lib/gpsSource';
import {
  DEFAULT_MAP_BASEMAP_ID,
  getMapOverlayColors,
  MAP_BASEMAPS,
} from '@/renderer/lib/mapBasemapUtils';
import {
  joinRmapDiscoveryWithPeers,
  matchesRmapInterfaceFilter,
  type ReticulumMapMarkerRow,
  type RmapInterfaceFilter,
} from '@/renderer/lib/reticulum/reticulumDiscoveryMapLayout';
import { RMAP_GLOBAL_MAP_URL } from '@/renderer/lib/reticulum/reticulumRmapDiscovery';
import {
  fetchReticulumRmapDiscovered,
  isReticulumSidecarRunning,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import { useMapViewportStore } from '@/renderer/stores/mapViewportStore';
import { useReticulumDiscoveryMapStore } from '@/renderer/stores/reticulumDiscoveryMapStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';

const REFRESH_MS = 30_000;
const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;
const LIST_FLY_ZOOM = 14;

interface MapFlyTarget {
  lat: number;
  lon: number;
  zoom: number;
  token: number;
}

function MapFlyToController({ target }: { target: MapFlyTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lon)) return;
    map.flyTo([target.lat, target.lon], target.zoom, { duration: 0.5 });
  }, [map, target]);
  return null;
}

function FitBoundsOnMarkers({
  markers,
  selfLat,
  selfLon,
  shouldFitOnMount,
}: {
  markers: { latitude: number; longitude: number }[];
  selfLat?: number | null;
  selfLon?: number | null;
  shouldFitOnMount: boolean;
}) {
  const map = useMap();
  const hasPerformedInitialFitRef = useRef(false);

  useEffect(() => {
    if (!shouldFitOnMount || hasPerformedInitialFitRef.current) return;
    hasPerformedInitialFitRef.current = true;
    const points: L.LatLngExpression[] = markers.map((m) => [m.latitude, m.longitude]);
    if (selfLat != null && selfLon != null) {
      points.push([selfLat, selfLon]);
    }
    flyMapToBounds(map, points);
  }, [map, markers, selfLat, selfLon, shouldFitOnMount]);

  return null;
}

function markerColor(reachable: boolean, isDark: boolean): string {
  const colors = getMapOverlayColors(isDark);
  return reachable ? colors.online : colors.offline;
}

function buildMarkerIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.35)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export interface ReticulumMapPanelProps {
  stackConfigured: boolean;
  onPeerClick?: (transportId: string) => void;
  onOpenRmapSettings?: () => void;
  onOpenAppGpsSettings?: () => void;
}

export default function ReticulumMapPanel({
  stackConfigured,
  onPeerClick,
  onOpenRmapSettings,
  onOpenAppGpsSettings,
}: ReticulumMapPanelProps) {
  const { t } = useTranslation();
  const basemapId = useMapLayerStore((s) => s.basemapId);
  const basemap = MAP_BASEMAPS[basemapId] ?? MAP_BASEMAPS[DEFAULT_MAP_BASEMAP_ID];
  const overlayColors = getMapOverlayColors(basemap.isDark);
  const savedViewport = useMapViewportStore((s) => s.viewport);

  const discovered = useReticulumDiscoveryMapStore((s) => s.discovered);
  const loading = useReticulumDiscoveryMapStore((s) => s.loading);
  const setDiscovered = useReticulumDiscoveryMapStore((s) => s.setDiscovered);
  const setLoading = useReticulumDiscoveryMapStore((s) => s.setLoading);
  const clearDiscovered = useReticulumDiscoveryMapStore((s) => s.clear);

  const peers = useReticulumPeerStore((s) => s.peers);
  const [filter, setFilter] = useState<RmapInterfaceFilter>('all');
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<MapFlyTarget | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [showScrollTopButton, setShowScrollTopButton] = useState(false);
  const listScrollRef = useRef<HTMLUListElement>(null);

  const selfCoords = readStoredStaticGps();

  const [initialViewport] = useState(() => ({
    center: savedViewport?.center ?? DEFAULT_CENTER,
    zoom: savedViewport?.zoom ?? DEFAULT_ZOOM,
  }));

  useEffect(() => {
    ensureMapStyles();
  }, []);

  const locateMe = useCallback(async () => {
    const coords = readStoredStaticGps();
    if (coords) {
      return { lat: coords.lat, lon: coords.lon };
    }
    const result = await window.electronAPI.getGpsFix();
    if ('status' in result && result.status === 'error') {
      return null;
    }
    if (!('lat' in result) || !('lon' in result)) {
      return null;
    }
    return { lat: result.lat, lon: result.lon };
  }, []);

  const refresh = useCallback(async () => {
    if (!stackConfigured) {
      clearDiscovered();
      return;
    }
    setLoading(true);
    setRefreshError(null);
    try {
      const running = await isReticulumSidecarRunning();
      if (!running) {
        clearDiscovered();
        return;
      }
      const rows = await fetchReticulumRmapDiscovered();
      setDiscovered(rows);
    } catch (e) {
      setRefreshError(errLikeToLogString(e));
      console.debug('[ReticulumMapPanel] refresh ' + errLikeToLogString(e));
    } finally {
      setLoading(false);
    }
  }, [clearDiscovered, setDiscovered, setLoading, stackConfigured]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [refresh]);

  const layout = useMemo(
    () => joinRmapDiscoveryWithPeers(discovered, [...peers.values()]),
    [discovered, peers],
  );

  const filteredMarkers = useMemo(
    () => layout.markers.filter((row) => matchesRmapInterfaceFilter(row, filter)),
    [filter, layout.markers],
  );
  const filteredListOnly = useMemo(
    () => layout.listOnly.filter((row) => matchesRmapInterfaceFilter(row, filter)),
    [filter, layout.listOnly],
  );

  const listRows = useMemo(
    () =>
      [...filteredMarkers, ...filteredListOnly].sort((a, b) =>
        a.discovery_name.localeCompare(b.discovery_name),
      ),
    [filteredListOnly, filteredMarkers],
  );

  const handleListItemClick = useCallback((row: ReticulumMapMarkerRow) => {
    setSelectedHash(row.discovery_hash);
    const hasCoords =
      row.has_coordinates &&
      Number.isFinite(row.latitude) &&
      Number.isFinite(row.longitude) &&
      !(row.latitude === 0 && row.longitude === 0);
    if (hasCoords) {
      setFlyTarget({
        lat: row.latitude,
        lon: row.longitude,
        zoom: LIST_FLY_ZOOM,
        token: Date.now(),
      });
    }
  }, []);

  const updateListScrollTopButton = useCallback(() => {
    const scrollTop = listScrollRef.current?.scrollTop ?? 0;
    setShowScrollTopButton(scrollTop > CHAT_SCROLL_END_THRESHOLD);
  }, []);

  const scrollListToTop = useCallback(() => {
    listScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const emptyReason = !stackConfigured
    ? 'stackOff'
    : discovered.length === 0
      ? 'noDiscoveries'
      : filteredMarkers.length === 0 && filteredListOnly.length === 0
        ? 'filterEmpty'
        : null;

  const hasMapPositions =
    filteredMarkers.length > 0 || selfCoords != null || filteredListOnly.length > 0;
  const shouldFitOnMount = savedViewport == null && filteredMarkers.length > 0;

  const reachableCount = useMemo(() => listRows.filter((row) => row.reachable).length, [listRows]);
  const heardOnlyCount = listRows.length - reachableCount;

  return (
    <div className="flex h-full min-h-[500px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{t('reticulumMap.title')}</h2>
          <p className="text-xs text-slate-400">{t('reticulumMap.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={RMAP_GLOBAL_MAP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
            aria-label={t('reticulumMap.openGlobalMapAria')}
          >
            <Globe className="h-3.5 w-3.5" aria-hidden />
            {t('reticulumMap.openGlobalMap')}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
          {onOpenRmapSettings ? (
            <button
              type="button"
              onClick={onOpenRmapSettings}
              className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
              aria-label={t('reticulumMap.openPublishSettingsAria')}
            >
              {t('reticulumMap.openPublishSettings')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-60"
            aria-label={t('reticulumMap.refreshAria')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            {t('reticulumMap.refresh')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-1">
        {(['all', 'rnode', 'backbone', 'i2p', 'tcp', 'other'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setFilter(value);
            }}
            className={`rounded-full px-2.5 py-0.5 text-xs ${
              filter === value
                ? 'bg-cyan-700 text-white'
                : 'border border-slate-600 bg-slate-800 text-slate-300'
            }`}
            aria-pressed={filter === value}
            aria-label={t(`reticulumMap.filter.${value}`)}
          >
            {t(`reticulumMap.filter.${value}`)}
          </button>
        ))}
        <span className="text-xs text-slate-500">
          {t('reticulumMap.countSummary', {
            markers: filteredMarkers.length,
            list: filteredListOnly.length,
          })}
        </span>
      </div>

      {refreshError ? (
        <p className="px-1 text-xs text-red-400" role="status">
          {t('reticulumMap.refreshFailed', { error: refreshError })}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_280px]">
        <div
          className="relative min-h-[420px] overflow-hidden rounded-lg border border-gray-700/50"
          aria-label={t('reticulumMap.title')}
        >
          <div className="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2">
            <div className="bg-deep-black/80 flex items-center gap-3 rounded-lg border border-gray-700 px-3 py-1.5 text-xs backdrop-blur-sm">
              <span
                className="flex items-center gap-1 text-slate-200"
                title={t('reticulumMap.reachable')}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: overlayColors.online }}
                />
                {reachableCount}
              </span>
              <span
                className="flex items-center gap-1 text-slate-200"
                title={t('reticulumMap.heardOnly')}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: overlayColors.offline }}
                />
                {heardOnlyCount}
              </span>
            </div>
            <MapBasemapControl />
          </div>

          <MapContainer
            center={initialViewport.center}
            zoom={initialViewport.zoom}
            className="absolute inset-0"
            preferCanvas
            scrollWheelZoom
          >
            <TileLayer
              key={basemapId}
              url={basemap.url}
              attribution={basemap.attribution}
              keepBuffer={1}
              updateWhenIdle
            />
            <MapResizeInvalidator active />
            <MapViewportSaver hasAnyPositions={hasMapPositions} />
            <LocateMeControl onLocateMe={locateMe} />
            <MapFlyToController target={flyTarget} />
            <FitBoundsOnMarkers
              markers={filteredMarkers}
              selfLat={selfCoords?.lat}
              selfLon={selfCoords?.lon}
              shouldFitOnMount={shouldFitOnMount}
            />
            {selfCoords ? (
              <Marker
                position={[selfCoords.lat, selfCoords.lon]}
                icon={buildMarkerIcon(overlayColors.online)}
              >
                <Popup>{t('reticulumMap.selfMarker')}</Popup>
              </Marker>
            ) : null}
            {filteredMarkers.map((row) => (
              <Marker
                key={row.discovery_hash}
                position={[row.latitude, row.longitude]}
                icon={buildMarkerIcon(markerColor(row.reachable, basemap.isDark))}
                eventHandlers={{
                  click: () => onPeerClick?.(row.transport_id),
                }}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold">{row.discovery_name}</div>
                    <div className="text-xs">{row.interface_type}</div>
                    {row.reachable ? (
                      <div className="mt-1 text-xs text-green-700">
                        {t('reticulumMap.reachable')}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-600">
                        {t('reticulumMap.heardOnly')}
                      </div>
                    )}
                    <div className="mt-1 text-xs text-slate-600">
                      {t('reticulumMap.lastHeard', {
                        time: new Date(row.last_heard * 1000).toLocaleString(),
                      })}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {emptyReason ? (
            <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-slate-950/40 p-6">
              <div className="pointer-events-auto max-w-md rounded-lg border border-dashed border-slate-700 bg-slate-900/90 p-6 text-center">
                <MapPin className="mx-auto h-8 w-8 text-slate-500" aria-hidden />
                <p className="mt-2 text-sm text-slate-300">
                  {t(`reticulumMap.empty.${emptyReason}`)}
                </p>
                {emptyReason === 'noDiscoveries' ? (
                  <p className="mt-2 text-xs text-slate-500">{t('reticulumMap.empty.hint')}</p>
                ) : null}
                {emptyReason === 'stackOff' && onOpenRmapSettings ? (
                  <button
                    type="button"
                    className="mt-3 text-xs text-cyan-400 underline"
                    onClick={onOpenRmapSettings}
                  >
                    {t('reticulumMap.openPublishSettings')}
                  </button>
                ) : null}
                {!selfCoords && onOpenAppGpsSettings ? (
                  <button
                    type="button"
                    className="mt-3 text-xs text-cyan-400 underline"
                    onClick={onOpenAppGpsSettings}
                  >
                    {t('reticulumRmapDiscovery.openAppGps')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900/50">
          <h3 className="shrink-0 border-b border-slate-700 px-2 py-1.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
            {t('reticulumMap.listTitle')}
          </h3>
          <ul
            ref={listScrollRef}
            onScroll={updateListScrollTopButton}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {listRows.length === 0 ? (
              <li className="px-2 py-3 text-[11px] text-slate-500">
                {t('reticulumMap.empty.hint')}
              </li>
            ) : (
              listRows.map((row) => {
                const hasCoords =
                  row.has_coordinates &&
                  Number.isFinite(row.latitude) &&
                  Number.isFinite(row.longitude) &&
                  !(row.latitude === 0 && row.longitude === 0);
                const isSelected = selectedHash === row.discovery_hash;
                return (
                  <li
                    key={row.discovery_hash}
                    className="border-b border-slate-800/80 last:border-b-0"
                  >
                    <button
                      type="button"
                      className={`w-full px-2 py-1 text-left transition-colors hover:bg-slate-800/70 ${
                        isSelected ? 'bg-slate-800/90' : ''
                      }`}
                      onClick={() => {
                        handleListItemClick(row);
                      }}
                      aria-label={t('reticulumMap.openNodeAria', { name: row.discovery_name })}
                      aria-current={isSelected ? 'true' : undefined}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            row.reachable ? 'bg-brand-green' : 'bg-slate-500'
                          }`}
                          aria-hidden
                        />
                        <span className="truncate text-xs font-medium text-slate-100">
                          {row.discovery_name}
                        </span>
                      </div>
                      <div className="truncate pl-3 text-[10px] leading-tight text-slate-500">
                        {row.interface_type}
                        {!hasCoords ? ` · ${t('reticulumMap.noCoords')}` : ''}
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {showScrollTopButton ? (
            <button
              type="button"
              onClick={scrollListToTop}
              className="bg-secondary-dark absolute top-9 right-2 z-10 rounded-full border border-gray-600 px-2.5 py-1 text-[10px] font-medium text-gray-300 shadow-lg transition-all hover:bg-gray-600"
              aria-label={t('aria.backToTop')}
            >
              {t('app.scrollToTop')}
            </button>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
