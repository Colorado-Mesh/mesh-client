/* eslint-disable react-hooks/set-state-in-effect */
import L from 'leaflet';
import { ExternalLink, Globe, MapPin, RefreshCw } from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';

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
  type RmapInterfaceFilter,
} from '@/renderer/lib/reticulum/reticulumDiscoveryMapLayout';
import { RMAP_GLOBAL_MAP_URL } from '@/renderer/lib/reticulum/reticulumRmapDiscovery';
import {
  fetchReticulumRmapDiscovered,
  isReticulumSidecarRunning,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import { useReticulumDiscoveryMapStore } from '@/renderer/stores/reticulumDiscoveryMapStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';

const REFRESH_MS = 30_000;

function FitBoundsOnMarkers({
  markers,
  selfLat,
  selfLon,
}: {
  markers: { latitude: number; longitude: number }[];
  selfLat?: number | null;
  selfLon?: number | null;
}) {
  const map = useMap();
  useEffect(() => {
    const points: L.LatLngExpression[] = markers.map((m) => [m.latitude, m.longitude]);
    if (selfLat != null && selfLon != null) {
      points.push([selfLat, selfLon]);
    }
    if (points.length === 0) {
      map.setView([20, 0], 2);
      return;
    }
    if (points.length === 1) {
      map.setView(points[0], 8);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 12 });
  }, [map, markers, selfLat, selfLon]);
  return null;
}

function markerColor(status: string, reachable: boolean, isDark: boolean): string {
  const colors = getMapOverlayColors(isDark);
  if (reachable) {
    return colors.online;
  }
  if (status === 'stale') {
    return colors.stale;
  }
  if (status === 'available') {
    return isDark ? '#38bdf8' : '#0369a1';
  }
  return colors.offline;
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

  const discovered = useReticulumDiscoveryMapStore((s) => s.discovered);
  const loading = useReticulumDiscoveryMapStore((s) => s.loading);
  const setDiscovered = useReticulumDiscoveryMapStore((s) => s.setDiscovered);
  const setLoading = useReticulumDiscoveryMapStore((s) => s.setLoading);
  const clearDiscovered = useReticulumDiscoveryMapStore((s) => s.clear);

  const peers = useReticulumPeerStore((s) => s.peers);
  const [filter, setFilter] = useState<RmapInterfaceFilter>('all');
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const selfCoords = readStoredStaticGps();

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

  const emptyReason = !stackConfigured
    ? 'stackOff'
    : discovered.length === 0
      ? 'noDiscoveries'
      : filteredMarkers.length === 0 && filteredListOnly.length === 0
        ? 'filterEmpty'
        : null;

  return (
    <div className="flex h-full min-h-[420px] flex-col gap-3">
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

      {emptyReason ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center">
          <MapPin className="h-8 w-8 text-slate-500" aria-hidden />
          <p className="text-sm text-slate-300">{t(`reticulumMap.empty.${emptyReason}`)}</p>
          {emptyReason === 'noDiscoveries' ? (
            <p className="max-w-md text-xs text-slate-500">{t('reticulumMap.empty.hint')}</p>
          ) : null}
          {emptyReason === 'stackOff' && onOpenRmapSettings ? (
            <button
              type="button"
              className="text-xs text-cyan-400 underline"
              onClick={onOpenRmapSettings}
            >
              {t('reticulumMap.openPublishSettings')}
            </button>
          ) : null}
          {!selfCoords && onOpenAppGpsSettings ? (
            <button
              type="button"
              className="text-xs text-cyan-400 underline"
              onClick={onOpenAppGpsSettings}
            >
              {t('reticulumRmapDiscovery.openAppGps')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_280px]">
          <div className="relative min-h-[320px] overflow-hidden rounded-lg border border-slate-700">
            <MapContainer
              center={[20, 0]}
              zoom={2}
              className="leaflet-container h-full min-h-[320px] w-full"
              scrollWheelZoom
            >
              <TileLayer url={basemap.url} attribution={basemap.attribution} />
              <FitBoundsOnMarkers
                markers={filteredMarkers}
                selfLat={selfCoords?.lat}
                selfLon={selfCoords?.lon}
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
                  icon={buildMarkerIcon(markerColor(row.status, row.reachable, basemap.isDark))}
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
          </div>

          <aside className="flex max-h-[420px] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900/50">
            <h3 className="border-b border-slate-700 px-3 py-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
              {t('reticulumMap.listTitle')}
            </h3>
            <ul className="min-h-0 flex-1 overflow-y-auto text-sm">
              {[...filteredMarkers, ...filteredListOnly].map((row) => (
                <li
                  key={row.discovery_hash}
                  className="border-b border-slate-800 px-3 py-2 last:border-b-0"
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => onPeerClick?.(row.transport_id)}
                    aria-label={t('reticulumMap.openNodeAria', { name: row.discovery_name })}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-slate-100">
                        {row.discovery_name}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          row.status === 'available'
                            ? 'bg-green-700 text-white'
                            : row.status === 'stale'
                              ? 'bg-violet-700 text-white'
                              : 'bg-slate-600 text-white'
                        }`}
                      >
                        {t(`reticulumMap.status.${row.status}`, {
                          defaultValue: row.status,
                        })}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-400">
                      {row.interface_type}
                      {row.reachable ? ` · ${t('reticulumMap.reachable')}` : ''}
                      {!row.has_coordinates ? ` · ${t('reticulumMap.noCoords')}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
