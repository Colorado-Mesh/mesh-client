import 'leaflet/dist/leaflet.css';

import { DomEvent } from 'leaflet';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Crosshair,
  GripVertical,
  Info,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Route,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react-motion';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';

import { useBeaconTraffic } from '@/renderer/hooks/useBeaconTraffic';
import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import type { OurPosition } from '@/renderer/lib/gpsSource';
import { groupLiveTrafficEvents, liveTrafficPointKey } from '@/renderer/lib/map/liveTrafficGroups';
import {
  buildLiveTrafficEvents,
  buildLiveTrafficNodeIndex,
  buildMeshtasticLiveTrafficEvents,
  filterLiveTrafficEvents,
  LIVE_TRAFFIC_MAX_AGE_MS,
  type LiveTrafficBounds,
  type LiveTrafficEvent,
  liveTrafficLongitudeNear,
  type LiveTrafficPoint,
  pointInLiveTrafficBounds,
} from '@/renderer/lib/map/liveTrafficModel';
import { useFloatingMapWindow } from '@/renderer/lib/map/useFloatingMapWindow';
import {
  DEFAULT_MAP_BASEMAP_ID,
  getMapOverlayColors,
  MAP_BASEMAPS,
  MAP_MAX_ZOOM,
  type MapBasemapId,
  meshTilesAvailable,
} from '@/renderer/lib/mapBasemapUtils';
import type { RxPacketEntry } from '@/renderer/lib/meshcore/meshcoreHookTypes';
import type { MeshtasticRawPacketEntry } from '@/renderer/lib/rawPacketLogConstants';
import type { MeshNode } from '@/renderer/lib/types';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import type { MapViewport } from '@/renderer/stores/mapViewportStore';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';
import type { RegionalFeedProvider } from '@/shared/beacon';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { Button, IconButton } from '../ui/Button';
import { INPUT_BOX_SM_CLASS, SELECT_BOX_SM_CLASS } from '../ui/formClasses';
import { BeaconConnectionControls } from './BeaconConnectionControls';
import { ensureMapStyles, MapResizeInvalidator } from './leafletMapControls';
import {
  LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP,
  LiveTrafficCanvas,
  liveTrafficPacketColors,
} from './LiveTrafficCanvas';

const MAX_FEED_EVENTS = 25;
const MAX_MAP_MARKERS = 400;
const MAX_INSPECTOR_LOCATIONS = 32;
const EMPTY_MESHCORE_PACKETS: readonly RxPacketEntry[] = [];
const EMPTY_MESHTASTIC_PACKETS: readonly MeshtasticRawPacketEntry[] = [];
const EMPTY_EVENTS: readonly LiveTrafficEvent[] = [];
const EMPTY_NODE_INDEX = buildLiveTrafficNodeIndex(new Map());
const INITIAL_CENTER: [number, number] = [20, 0];

export interface LiveTrafficPanelProps {
  active?: boolean;
  nodes: Map<number, MeshNode>;
  myNodeNum: number;
  meshcorePackets?: readonly RxPacketEntry[];
  meshtasticPackets?: readonly MeshtasticRawPacketEntry[];
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>;
  onNodeClick?: (id: number) => void;
  ourPosition?: OurPosition | null;
}

function packetCategory(kind: string): 'message' | 'advert' | 'telemetry' | 'routing' | 'other' {
  if (/TXT|TEXT|MESSAGE/i.test(kind)) return 'message';
  if (/ADVERT|POSITION|NODEINFO/i.test(kind)) return 'advert';
  if (/TELEMETRY|STATUS/i.test(kind)) return 'telemetry';
  if (/ACK|TRACE|PATH|ROUT|REQ|RESP/i.test(kind)) return 'routing';
  return 'other';
}

function scopeLabel(code: number): string {
  return `0x${code.toString(16).padStart(4, '0')}`;
}

function pointInMarkerViewport(point: LiveTrafficPoint, bounds: LiveTrafficBounds | null): boolean {
  if (!bounds) return true;
  const latitudePadding = (bounds.north - bounds.south) * 0.1;
  if (point.lat < bounds.south - latitudePadding || point.lat > bounds.north + latitudePadding)
    return false;
  const longitudeSpan =
    bounds.east >= bounds.west ? bounds.east - bounds.west : bounds.east + 360 - bounds.west;
  if (longitudeSpan >= 360) return true;
  const center = bounds.west + longitudeSpan / 2;
  const distance = ((((point.lon - center + 180) % 360) + 360) % 360) - 180;
  return Math.abs(distance) <= longitudeSpan * 0.6;
}

function TrafficViewport({
  regionId,
  points,
  trafficPoints,
  focusRevision,
  onBounds,
  initialViewport,
  onViewport,
}: {
  regionId: string;
  points: readonly LiveTrafficPoint[];
  trafficPoints: readonly LiveTrafficPoint[];
  focusRevision: number;
  onBounds: (bounds: LiveTrafficBounds) => void;
  initialViewport: MapViewport | null;
  onViewport: (viewport: MapViewport) => void;
}) {
  const map = useMap();
  const previousFit = useRef<string | null>(
    initialViewport ? `${regionId}:${focusRevision}:${points.length > 0}` : null,
  );
  const previousFocusRevision = useRef(focusRevision);
  const reportBounds = useCallback(() => {
    const bounds = map.getBounds();
    const center = map.getCenter();
    onViewport({ center: [center.lat, center.lng], zoom: map.getZoom() });
    onBounds({
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast(),
    });
  }, [map, onBounds, onViewport]);
  useMapEvents({ moveend: reportBounds, resize: reportBounds });
  useEffect(() => {
    const fitKey = `${regionId}:${focusRevision}:${points.length > 0}`;
    if (previousFit.current === fitKey) return;
    previousFit.current = fitKey;
    const explicitFocus = previousFocusRevision.current !== focusRevision;
    previousFocusRevision.current = focusRevision;
    const fitPoints = explicitFocus && trafficPoints.length > 0 ? trafficPoints : points;
    if (
      (regionId === 'all' || (regionId === 'viewport' && explicitFocus)) &&
      fitPoints.length > 0
    ) {
      map.fitBounds(
        fitPoints.map((point) => [point.lat, point.lon]),
        {
          padding: [48, 48],
          maxZoom: 10,
          animate: false,
        },
      );
    }
    reportBounds();
  }, [map, regionId, points, trafficPoints, focusRevision, reportBounds]);
  return null;
}

function TrafficZoomControls({ onFit }: { onFit: () => void }) {
  const map = useMap();
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    DomEvent.disableClickPropagation(container);
    DomEvent.disableScrollPropagation(container);
    return () => {
      DomEvent.off(container);
    };
  }, []);
  return (
    <div
      className="border-ink-700 bg-deep-black/90 shadow-level-1 rounded-control absolute top-3 right-3 z-[500] flex flex-col overflow-hidden border"
      ref={containerRef}
      role="group"
      aria-label={t('liveTraffic.zoomControls')}
    >
      <IconButton
        size="sm"
        variant="ghost"
        className="rounded-none"
        aria-label={t('liveTraffic.zoomIn')}
        title={t('liveTraffic.zoomIn')}
        onClick={() => map.zoomIn(0.5)}
        icon={<Plus aria-hidden className="h-4 w-4" />}
      />
      <IconButton
        size="sm"
        variant="ghost"
        className="rounded-none"
        aria-label={t('liveTraffic.zoomOut')}
        title={t('liveTraffic.zoomOut')}
        onClick={() => map.zoomOut(0.5)}
        icon={<Minus aria-hidden className="h-4 w-4" />}
      />
      <IconButton
        size="sm"
        variant="ghost"
        className="border-ink-700 rounded-none border-t"
        aria-label={t('liveTraffic.fitTraffic')}
        title={t('liveTraffic.fitTraffic')}
        onClick={onFit}
        icon={<Crosshair aria-hidden className="h-3.5 w-3.5" />}
      />
    </div>
  );
}

const TrafficNodeMarker = memo(function TrafficNodeMarker({
  point,
  longitudeCenter,
  selected,
  self,
  color,
  onNodeClick,
}: {
  point: LiveTrafficPoint;
  longitudeCenter: number;
  selected: boolean;
  self: boolean;
  color: string;
  onNodeClick?: (id: number) => void;
}) {
  const center = useMemo<[number, number]>(
    () => [point.lat, liveTrafficLongitudeNear(point.lon, longitudeCenter)],
    [point.lat, point.lon, longitudeCenter],
  );
  const pathOptions = useMemo(
    () => ({
      color,
      weight: selected || self ? 1.5 : 1,
      opacity: selected || self ? 0.9 : 0.55,
      fillColor: color,
      fillOpacity: selected ? 0.85 : self ? 0.45 : 0.18,
    }),
    [color, selected, self],
  );
  const eventHandlers = useMemo(
    () => ({
      click: () => {
        if (point.nodeId !== null) onNodeClick?.(point.nodeId);
      },
    }),
    [point.nodeId, onNodeClick],
  );
  return (
    <CircleMarker
      center={center}
      radius={selected ? 6 : self ? 5 : 2.5}
      pathOptions={pathOptions}
      eventHandlers={eventHandlers}
    >
      <Tooltip className="live-traffic-label" direction="top" offset={[0, -5]}>
        {point.label}
      </Tooltip>
    </CircleMarker>
  );
});

/** Read-only observations from local packet logs or a connected regional feed. */
export default function LiveTrafficPanel({
  active = true,
  nodes,
  myNodeNum,
  meshcorePackets,
  meshtasticPackets,
  pubKeyByNodeId,
  onNodeClick,
  ourPosition,
}: LiveTrafficPanelProps) {
  const { t } = useTranslation();
  const scopeListId = useId();
  const moveHintId = useId();
  const packetDescriptionId = useId();
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const feedWindowRef = useRef<HTMLElement>(null);
  const sourceTriggerRef = useRef<HTMLButtonElement>(null);
  const sourcePopoverRef = useRef<HTMLDivElement>(null);
  const floatingFeed = useFloatingMapWindow(mapFrameRef, feedWindowRef, active);
  const use24Hour = useTimeFormatStore((state) => state.use24HourTime);
  const savedBasemap = useMapLayerStore((state) => state.basemapId);
  const meshtastic = meshtasticPackets !== undefined;
  const [trafficSource, setTrafficSource] = useState<'local' | RegionalFeedProvider>('local');
  const regional = trafficSource !== 'local';
  const provider = trafficSource === 'corescope' ? 'corescope' : 'beacon';
  const beacon = useBeaconTraffic(!meshtastic && regional, provider, active);
  const [paused, setPaused] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const closeSource = useCallback(() => {
    setSourceOpen(false);
    sourceTriggerRef.current?.focus();
  }, []);
  const [infoOpen, setInfoOpen] = useState(false);
  const [pausedAt, setPausedAt] = useState(0);
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedExpanded, setFeedExpanded] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [regionId, setRegionId] = useState('all');
  const [scope, setScope] = useState('');
  const [kind, setKind] = useState('all');
  const [speed, setSpeed] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedViewport, setSavedViewport] = useState<MapViewport | null>(null);
  const [viewport, setViewport] = useState<LiveTrafficBounds | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const [basemapId, setBasemapId] = useState<MapBasemapId>(savedBasemap);
  const [frozenEvents, setFrozenEvents] = useState<readonly LiveTrafficEvent[]>([]);
  const [refreshTime, setRefreshTime] = useState(Date.now);
  useEffect(() => {
    if (!active || !sourceOpen || !regional) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeSource();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        sourcePopoverRef.current?.contains(event.target) ||
        sourceTriggerRef.current?.contains(event.target)
      )
        return;
      closeSource();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [active, sourceOpen, regional, closeSource]);
  const receiverLat = ourPosition?.lat;
  const receiverLon = ourPosition?.lon;
  const receiverSource = ourPosition?.source;
  const index = useMemo(
    () =>
      active && !regional
        ? buildLiveTrafficNodeIndex(nodes, pubKeyByNodeId, {
            nodeId: myNodeNum,
            position:
              receiverLat == null || receiverLon == null || receiverSource == null
                ? null
                : { lat: receiverLat, lon: receiverLon, source: receiverSource },
          })
        : EMPTY_NODE_INDEX,
    [active, regional, nodes, pubKeyByNodeId, myNodeNum, receiverLat, receiverLon, receiverSource],
  );
  const liveEvents = useMemo(() => {
    if (!active) return EMPTY_EVENTS;
    const now = refreshTime;
    if (regional && !meshtastic)
      return beacon.events.filter((event) => now - event.ts <= LIVE_TRAFFIC_MAX_AGE_MS);
    return meshtastic
      ? buildMeshtasticLiveTrafficEvents(
          meshtasticPackets ?? EMPTY_MESHTASTIC_PACKETS,
          index,
          myNodeNum,
          now,
        )
      : buildLiveTrafficEvents(meshcorePackets ?? EMPTY_MESHCORE_PACKETS, index, myNodeNum, now);
  }, [
    active,
    meshtastic,
    meshcorePackets,
    meshtasticPackets,
    index,
    myNodeNum,
    refreshTime,
    regional,
    beacon.events,
  ]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setRefreshTime(Date.now());
    });
    return () => {
      cancelled = true;
    };
  }, [active, meshcorePackets, meshtasticPackets, visible, beacon.events]);

  useEffect(() => {
    ensureMapStyles();
    const onVisibility = () => {
      setVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!active || paused || !visible || liveEvents.length === 0) return;
    const timer = window.setInterval(() => {
      setRefreshTime(Date.now());
    }, 5 * MS_PER_SECOND);
    return () => {
      window.clearInterval(timer);
    };
  }, [active, paused, visible, liveEvents.length]);

  const events = paused ? frozenEvents : liveEvents;
  const points = useMemo(
    () => (regional ? beacon.points : [...index.points.values()]),
    [regional, beacon.points, index],
  );
  const bounds = regionId === 'viewport' ? viewport : null;
  const normalizedScope = scope.toLowerCase();
  const parsedScope =
    scope === ''
      ? 'all'
      : normalizedScope === 'unscoped' ||
          normalizedScope === t('liveTraffic.unscoped').toLowerCase()
        ? 'unscoped'
        : normalizedScope === 'scoped' || normalizedScope === t('liveTraffic.scoped').toLowerCase()
          ? 'scoped'
          : /^(?:0x)?[0-9a-f]{1,8}$/i.test(scope)
            ? Number.parseInt(scope.replace(/^0x/i, ''), 16)
            : -1;
  const canvasEvents = useMemo(
    () =>
      groupLiveTrafficEvents(
        filterLiveTrafficEvents(liveEvents, {
          bounds,
          scope: meshtastic || regional ? 'all' : parsedScope,
        }).filter((event) => kind === 'all' || packetCategory(event.kind) === kind),
        refreshTime,
      ),
    [liveEvents, bounds, meshtastic, regional, parsedScope, kind, refreshTime],
  );
  const frozenGroups = useMemo(
    () =>
      groupLiveTrafficEvents(
        filterLiveTrafficEvents(frozenEvents, {
          bounds,
          scope: meshtastic || regional ? 'all' : parsedScope,
        }).filter((event) => kind === 'all' || packetCategory(event.kind) === kind),
        pausedAt,
      ),
    [frozenEvents, bounds, meshtastic, regional, parsedScope, kind, pausedAt],
  );
  const filteredEvents = paused ? frozenGroups : canvasEvents;
  const trafficFocusPoints = useMemo(
    () => [
      ...new Map(
        filteredEvents
          .slice(-MAX_FEED_EVENTS)
          .flatMap((event) => event.points.slice(-LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP))
          .map((point) => [liveTrafficPointKey(point), point]),
      ).values(),
    ],
    [filteredEvents],
  );
  const feed = useMemo(() => filteredEvents.slice(-MAX_FEED_EVENTS).reverse(), [filteredEvents]);
  const selected = filteredEvents.find((event) => event.id === selectedId);
  const scopeCodes = useMemo(
    () =>
      [
        ...new Set(events.flatMap((event) => (event.scopeCode === null ? [] : [event.scopeCode]))),
      ].sort((a, b) => a - b),
    [events],
  );
  const selectedNodeIds = useMemo(
    () => new Set(selected?.points.map(liveTrafficPointKey) ?? []),
    [selected],
  );
  const markerPoints = useMemo(() => {
    if (!active) return [];
    const activeNodeKeys = new Set(
      filteredEvents.flatMap((event) => event.points.map(liveTrafficPointKey)),
    );
    const selectedPoints: LiveTrafficPoint[] = [];
    const activePoints: LiveTrafficPoint[] = [];
    const otherPoints: LiveTrafficPoint[] = [];
    for (const point of points) {
      if (
        (bounds && !pointInLiveTrafficBounds(point, bounds)) ||
        !pointInMarkerViewport(point, viewport)
      )
        continue;
      const key = liveTrafficPointKey(point);
      if (selectedNodeIds.has(key)) selectedPoints.push(point);
      else if (activeNodeKeys.has(key) || point.nodeId === myNodeNum) activePoints.push(point);
      else otherPoints.push(point);
    }
    return [...selectedPoints, ...activePoints, ...otherPoints].slice(0, MAX_MAP_MARKERS);
  }, [active, points, bounds, viewport, filteredEvents, selectedNodeIds, myNodeNum]);
  const basemap = MAP_BASEMAPS[basemapId] ?? MAP_BASEMAPS[DEFAULT_MAP_BASEMAP_ID];
  const localTiles = meshTilesAvailable();
  const previewTiles = import.meta.env.DEV && !localTiles;
  const tileUrl = localTiles ? basemap.url : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const nodeColor = getMapOverlayColors(basemap.isDark).online;
  const mappedCount = filteredEvents.filter((event) => event.segments.length > 0).length;
  const sourceStatusColor = paused
    ? 'bg-status-warning'
    : regional && beacon.status !== 'live'
      ? 'bg-ink-400'
      : 'bg-status-success';

  const { connect: connectSource } = beacon;
  const connectBeacon = useCallback(
    async (baseUrl: string, region?: string) => {
      const connected = await connectSource(baseUrl, region);
      if (connected) {
        setSavedViewport(null);
        closeSource();
        setRegionId('all');
        setSelectedId(null);
        setPaused(false);
        setFrozenEvents([]);
        setFocusRevision((current) => current + 1);
      }
      return connected;
    },
    [connectSource, closeSource],
  );

  return (
    <section
      aria-label={t('liveTraffic.title')}
      hidden={!active}
      className={
        active
          ? 'bg-app-bg text-ink-200 relative flex h-full min-h-0 min-w-0 flex-col overflow-auto'
          : 'hidden'
      }
    >
      <header className="border-ink-800 bg-app-bg relative z-[700] flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-3 py-1.5">
        <h2 className="sr-only">{t('liveTraffic.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('liveTraffic.region')}
            className={`${SELECT_BOX_SM_CLASS} max-w-44`}
            value={regionId}
            onChange={(event) => {
              setRegionId(event.target.value);
            }}
          >
            <option value="all">{t('liveTraffic.areas.all')}</option>
            <option value="viewport">{t('liveTraffic.areas.viewport')}</option>
          </select>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('liveTraffic.filters')}
            aria-expanded={filtersOpen}
            onClick={() => {
              setFiltersOpen(!filtersOpen);
            }}
            icon={<SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />}
          >
            {t('liveTraffic.filters')}
          </Button>
          {!meshtastic && (
            <div className="flex items-center gap-1">
              <select
                aria-label={t('liveTraffic.trafficSource')}
                title={t('liveTraffic.trafficSource')}
                className={`${SELECT_BOX_SM_CLASS} max-w-44`}
                value={trafficSource}
                onChange={(event) => {
                  const nextSource =
                    event.target.value === 'corescope'
                      ? 'corescope'
                      : event.target.value === 'beacon'
                        ? 'beacon'
                        : 'local';
                  setTrafficSource(nextSource);
                  setPaused(false);
                  setSelectedId(null);
                  setScope('');
                  setRegionId('all');
                  setSourceOpen(nextSource !== 'local');
                }}
              >
                <option value="local">{t('liveTraffic.localRadio')}</option>
                <option value="beacon">{t('liveTraffic.beacon.feed')}</option>
                <option value="corescope">{t('liveTraffic.corescope.feed')}</option>
              </select>
              {regional && (
                <>
                  <span className={`h-1.5 w-1.5 rounded-full ${sourceStatusColor}`} aria-hidden />
                  <span
                    className={`${beacon.directoryLimited ? 'text-status-warning' : 'text-muted'} max-w-28 truncate text-xs`}
                    title={beacon.directoryLimited ? t('liveTraffic.directoryLimited') : undefined}
                    role="status"
                  >
                    {beacon.directoryLimited && beacon.status === 'live'
                      ? t('liveTraffic.directoryLimitedShort')
                      : t(`liveTraffic.connectionState.${beacon.status}`)}
                  </span>
                  <IconButton
                    ref={sourceTriggerRef}
                    size="sm"
                    variant="ghost"
                    aria-label={t('liveTraffic.beacon.configure')}
                    aria-expanded={sourceOpen}
                    onClick={() => {
                      setSourceOpen(!sourceOpen);
                    }}
                    icon={<Settings2 aria-hidden className="h-3.5 w-3.5" />}
                  />
                  <div
                    ref={sourcePopoverRef}
                    hidden={!sourceOpen}
                    role="region"
                    className="border-ink-700 bg-deep-black shadow-level-2 rounded-card absolute top-full left-3 z-[800] mt-2 w-[min(28rem,calc(100vw-2rem))] overflow-hidden border"
                    aria-label={t('liveTraffic.beacon.configure')}
                  >
                    <div className="flex items-center justify-between px-3 pt-2">
                      <span className="text-ink-200 text-xs font-medium">
                        {t('liveTraffic.beacon.configure')}
                      </span>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={t('liveTraffic.closeSource')}
                        onClick={closeSource}
                        icon={<X aria-hidden className="h-3.5 w-3.5" />}
                      />
                    </div>
                    <BeaconConnectionControls
                      provider={provider}
                      feed={{ ...beacon, connect: connectBeacon }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            size="sm"
            aria-label={t(paused ? 'liveTraffic.resume' : 'liveTraffic.pause')}
            aria-pressed={paused}
            onClick={() => {
              if (!paused) {
                setFrozenEvents(events);
                setPausedAt(Date.now());
              }
              setPaused(!paused);
            }}
            icon={
              paused ? (
                <Play aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <Pause aria-hidden className="h-3.5 w-3.5" />
              )
            }
          >
            {t(paused ? 'liveTraffic.resume' : 'liveTraffic.pause')}
          </Button>
        </div>
      </header>
      {filtersOpen && (
        <div className="border-ink-700 bg-deep-black shadow-level-2 flex flex-wrap items-end gap-3 border-b px-4 py-3">
          {!meshtastic && !regional && (
            <label className="text-muted flex min-w-36 flex-1 flex-col gap-1 text-xs sm:flex-none">
              {t('liveTraffic.transportScope')}
              <input
                aria-label={t('liveTraffic.transportScope')}
                aria-invalid={parsedScope === -1}
                title={t('liveTraffic.scopeHint')}
                className={`${INPUT_BOX_SM_CLASS} w-full sm:w-40`}
                list={scopeListId}
                value={scope}
                placeholder={t('liveTraffic.allScopes')}
                onChange={(event) => {
                  setScope(event.target.value.trim());
                }}
              />
              <datalist id={scopeListId}>
                <option value={t('liveTraffic.unscoped')} />
                <option value={t('liveTraffic.scoped')} />
                {scopeCodes.map((code) => (
                  <option key={code} value={scopeLabel(code)} />
                ))}
              </datalist>
            </label>
          )}
          <label className="text-muted flex min-w-32 flex-1 flex-col gap-1 text-xs sm:flex-none">
            {t('liveTraffic.packetType')}
            <select
              aria-label={t('liveTraffic.packetType')}
              className={SELECT_BOX_SM_CLASS}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
              }}
            >
              {['all', 'message', 'advert', 'telemetry', 'routing', 'other'].map((category) => (
                <option key={category} value={category}>
                  {t(`liveTraffic.kinds.${category}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-muted flex flex-col gap-1 text-xs">
            {t('liveTraffic.speed')}
            <select
              aria-label={t('liveTraffic.speed')}
              className={SELECT_BOX_SM_CLASS}
              value={speed}
              onChange={(event) => {
                setSpeed(Number(event.target.value));
              }}
            >
              <option value="1">{t('liveTraffic.speedNormal')}</option>
              <option value="2">{t('liveTraffic.speedFast')}</option>
            </select>
          </label>
          <label className="text-muted flex flex-col gap-1 text-xs">
            {t('liveTraffic.basemap')}
            <select
              aria-label={t('liveTraffic.basemap')}
              value={basemapId}
              onChange={(event) => {
                setBasemapId(event.target.value as MapBasemapId);
              }}
              className={SELECT_BOX_SM_CLASS}
            >
              <option value="dark">{t('liveTraffic.darkMap')}</option>
              <option value="osm">{t('liveTraffic.streetMap')}</option>
              {localTiles && <option value="usgs-topo">{t('liveTraffic.topographicMap')}</option>}
            </select>
          </label>
        </div>
      )}
      {active && (
        <div ref={mapFrameRef} className="relative min-h-0 flex-1">
          <div
            className="bg-app-bg relative isolate h-full min-h-0 overflow-hidden"
            aria-label={t('liveTraffic.mapAria')}
          >
            <MapContainer
              center={savedViewport?.center ?? INITIAL_CENTER}
              zoom={savedViewport?.zoom ?? 2}
              zoomSnap={0.5}
              wheelPxPerZoomLevel={180}
              wheelDebounceTime={0.08 * MS_PER_SECOND}
              zoomDelta={0.5}
              maxZoom={MAP_MAX_ZOOM}
              preferCanvas
              className="h-full min-h-0 w-full"
              zoomControl={false}
            >
              {(localTiles || previewTiles) && (
                <TileLayer
                  key={basemapId}
                  url={tileUrl}
                  attribution={previewTiles ? MAP_BASEMAPS.dark.attribution : basemap.attribution}
                  maxNativeZoom={basemap.maxNativeZoom}
                  className={basemap.tileClassName}
                />
              )}
              <MapResizeInvalidator active />
              <TrafficZoomControls
                onFit={() => {
                  setFocusRevision((value) => value + 1);
                }}
              />
              <TrafficViewport
                regionId={regionId}
                points={points}
                trafficPoints={trafficFocusPoints}
                focusRevision={focusRevision}
                onBounds={setViewport}
                initialViewport={savedViewport}
                onViewport={setSavedViewport}
              />
              <LiveTrafficCanvas
                key={`${meshtastic ? 'meshtastic' : 'meshcore'}:${trafficSource}`}
                skipInitialAnimation
                events={canvasEvents}
                inspectionEvents={paused ? frozenGroups : undefined}
                paused={paused || !visible}
                selectedId={selectedId ?? undefined}
                speed={speed}
              />
              {markerPoints.map((point, pointIndex) => (
                <TrafficNodeMarker
                  key={point.nodeId ?? `${point.lat}:${point.lon}:${pointIndex}`}
                  point={point}
                  longitudeCenter={viewport ? (viewport.west + viewport.east) / 2 : 0}
                  selected={selectedNodeIds.has(liveTrafficPointKey(point))}
                  self={point.nodeId === myNodeNum}
                  color={nodeColor}
                  onNodeClick={onNodeClick}
                />
              ))}
            </MapContainer>
            {events.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-[450] flex items-center justify-center p-5">
                <div className="border-ink-700 bg-deep-black/95 rounded-card shadow-level-2 max-w-xs border p-5 text-center">
                  <Radio aria-hidden className="text-muted mx-auto mb-3 h-6 w-6" />
                  <h3 className="mb-1 text-sm font-medium">{t('liveTraffic.waiting')}</h3>
                  <p className="text-muted text-xs leading-relaxed">
                    {t(
                      regional
                        ? beacon.status === 'live'
                          ? 'liveTraffic.beacon.listeningHint'
                          : provider === 'corescope'
                            ? 'liveTraffic.corescope.waitingHint'
                            : 'liveTraffic.beacon.waitingHint'
                        : 'liveTraffic.waitingHint',
                    )}
                  </p>
                </div>
              </div>
            )}
            <div className="absolute bottom-7 left-3 z-[500] flex items-center gap-2">
              <IconButton
                size="sm"
                variant="ghost"
                className="bg-deep-black/85"
                aria-label={t('liveTraffic.aboutMap')}
                aria-expanded={infoOpen}
                onClick={() => {
                  setInfoOpen(!infoOpen);
                }}
                icon={<Info aria-hidden className="h-3.5 w-3.5" />}
              />
              <span className="bg-deep-black/85 text-muted rounded-control px-2 py-1 text-xs">
                {t('liveTraffic.observationCount', { count: filteredEvents.length })}
              </span>
              {infoOpen && (
                <div
                  role="note"
                  aria-label={t('liveTraffic.aboutMap')}
                  className="border-ink-700 bg-deep-black/95 shadow-level-2 rounded-card absolute bottom-9 left-0 w-64 space-y-2 border p-3 text-xs"
                >
                  <p>
                    {t(
                      meshtastic
                        ? 'liveTraffic.meshtasticDisclaimer'
                        : 'liveTraffic.animationDisclaimer',
                    )}
                  </p>
                  <p className="text-muted">{t('liveTraffic.packetColorHint')}</p>
                  {filteredEvents.some((event) => event.routeStatus === 'estimated') && (
                    <p className="text-status-warning">{t('liveTraffic.estimatedRouteHint')}</p>
                  )}
                  <p className="text-muted">
                    {t('liveTraffic.mappedCount', { count: mappedCount })} ·{' '}
                    {t('liveTraffic.nodeCount', { count: markerPoints.length })}
                  </p>
                  <p className="text-muted">{t('liveTraffic.filterHint')}</p>
                </div>
              )}
            </div>
          </div>
          <aside
            ref={feedWindowRef}
            aria-label={t('liveTraffic.feed')}
            style={
              floatingFeed.position
                ? {
                    left: floatingFeed.position.x,
                    top: floatingFeed.position.y,
                    right: 'auto',
                    bottom: 'auto',
                  }
                : undefined
            }
            className={`border-ink-700 bg-deep-black/85 rounded-card shadow-level-2 absolute right-3 bottom-8 z-[600] flex max-h-[calc(100%-2rem)] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden border ${feedOpen ? (feedExpanded ? 'h-[32rem] w-[26rem]' : 'h-[20rem] w-[20rem]') : 'w-[20rem]'}`}
          >
            <div
              className={`flex shrink-0 items-center gap-2 px-3 py-2 ${feedOpen ? 'border-ink-700 border-b' : ''}`}
            >
              <button
                type="button"
                aria-label={t('liveTraffic.moveFeed')}
                aria-describedby={moveHintId}
                onPointerDown={floatingFeed.onPointerDown}
                onPointerMove={floatingFeed.onPointerMove}
                onPointerUp={floatingFeed.onPointerUp}
                onPointerCancel={floatingFeed.onPointerUp}
                onKeyDown={floatingFeed.onKeyDown}
                className="text-muted focus-visible:outline-brand-green rounded-control -ml-1 flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center focus-visible:outline-2 active:cursor-grabbing"
              >
                <GripVertical aria-hidden className="h-3.5 w-3.5" />
              </button>
              <span id={moveHintId} className="sr-only">
                {t('liveTraffic.moveFeedHint')}
              </span>
              <button
                type="button"
                aria-label={t('liveTraffic.toggleFeed')}
                aria-expanded={feedOpen}
                onClick={() => {
                  setFeedOpen(!feedOpen);
                }}
                className="text-ink-200 focus-visible:outline-brand-green rounded-control flex flex-1 items-center gap-2 text-left text-xs font-medium focus-visible:outline-2"
              >
                {feedOpen ? (
                  <ChevronDown aria-hidden className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp aria-hidden className="h-3.5 w-3.5" />
                )}
                {t('liveTraffic.feed')}
                <span className="text-muted ml-auto font-mono text-xs">{feed.length}</span>
              </button>
              {floatingFeed.position && (
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label={t('liveTraffic.resetFeed')}
                  onClick={floatingFeed.reset}
                  icon={<RotateCcw aria-hidden className="h-3 w-3" />}
                />
              )}
              {feedOpen && (
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label={t(feedExpanded ? 'liveTraffic.shrinkFeed' : 'liveTraffic.expandFeed')}
                  onClick={() => {
                    setFeedExpanded(!feedExpanded);
                  }}
                  icon={
                    feedExpanded ? (
                      <Minimize2 aria-hidden className="h-3.5 w-3.5" />
                    ) : (
                      <Maximize2 aria-hidden className="h-3.5 w-3.5" />
                    )
                  }
                />
              )}
            </div>
            {feedOpen && (
              <>
                <div className="min-h-20 flex-1 overflow-y-auto">
                  {feed.length === 0 ? (
                    <p className="text-muted p-4 text-xs leading-relaxed">
                      {t(events.length ? 'liveTraffic.noFilterMatches' : 'liveTraffic.emptyFeed')}
                    </p>
                  ) : (
                    <ol aria-label={t('liveTraffic.packetList')}>
                      {feed.map((event, eventIndex) => (
                        <li key={event.id}>
                          <button
                            type="button"
                            aria-label={t('liveTraffic.inspectPacket', {
                              kind: event.kind,
                              time: formatDisplayTime(event.ts, { withSeconds: true, use24Hour }),
                            })}
                            aria-describedby={`${packetDescriptionId}-${eventIndex}`}
                            aria-pressed={event.id === selectedId}
                            onClick={() => {
                              setSelectedId(event.id === selectedId ? null : event.id);
                            }}
                            className={`border-ink-800 hover:bg-ink-800/60 focus-visible:outline-brand-green w-full border-b px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${event.id === selectedId ? 'bg-sidebar-active-bg' : ''}`}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="inline-flex min-w-0 items-center gap-2">
                                <span
                                  aria-hidden
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: liveTrafficPacketColors(
                                      event.packetHash ?? event.id,
                                    ).line,
                                  }}
                                />
                                <span className="truncate font-mono text-xs">{event.kind}</span>
                                {event.source !== 'Beacon' && event.source !== 'CoreScope' && (
                                  <span className="text-muted shrink-0 text-xs">
                                    {t(`liveTraffic.sources.${event.source}`)}
                                  </span>
                                )}
                              </span>
                              <time
                                dateTime={new Date(event.ts).toISOString()}
                                className="text-muted shrink-0 font-mono text-xs"
                              >
                                {formatDisplayTime(event.ts, { withSeconds: true, use24Hour })}
                              </time>
                            </div>
                            <div id={`${packetDescriptionId}-${eventIndex}`}>
                              <div className="text-ink-300 flex items-center gap-1.5 text-xs">
                                <span className="truncate">
                                  {event.senderLabel ??
                                    (event.kind === 'CONTROL'
                                      ? event.controlSubtype === 'DISCOVER_REQ'
                                        ? t('liveTraffic.discoveryRequest')
                                        : event.controlSubtype === 'DISCOVER_RESP'
                                          ? t('liveTraffic.discoveryResponse')
                                          : t('liveTraffic.controlPacket')
                                      : t('weatherForecast.unknownSender'))}
                                </span>{' '}
                                {event.reportCount > 1 && (
                                  <span className="text-muted ml-auto shrink-0 font-mono text-xs">
                                    {t('liveTraffic.reports', { count: event.reportCount })}
                                  </span>
                                )}
                              </div>
                              {event.messageText ? (
                                <p className="text-ink-100 mt-1 truncate text-xs leading-relaxed">
                                  {event.messageText}
                                </p>
                              ) : packetCategory(event.kind) === 'message' ? (
                                <p className="text-muted mt-1 text-xs">
                                  {t(
                                    event.contentStatus === 'encrypted'
                                      ? 'liveTraffic.encryptedContent'
                                      : 'liveTraffic.contentUnavailable',
                                  )}
                                </p>
                              ) : null}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                {selected && (
                  <div className="border-ink-700 bg-app-bg/90 max-h-[13rem] shrink-0 overflow-y-auto border-t px-4 py-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="inline-flex items-center gap-2 text-sm font-medium">
                        <Route aria-hidden className="h-4 w-4" />
                        {t('liveTraffic.inspector')}
                      </h3>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label={t('liveTraffic.closeInspector')}
                        onClick={() => {
                          setSelectedId(null);
                        }}
                        icon={<X aria-hidden className="h-3.5 w-3.5" />}
                      />
                    </div>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
                      <dt className="text-muted">{t('liveTraffic.reportsLabel')}</dt>
                      <dd>{t('liveTraffic.reports', { count: selected.reportCount })}</dd>
                      <dt className="text-muted">{t('liveTraffic.route')}</dt>
                      <dd>{t(`liveTraffic.routeStatus.${selected.routeStatus}`)}</dd>
                      <dt className="text-muted">{t('liveTraffic.source')}</dt>
                      <dd>{t(`liveTraffic.sources.${selected.source}`)}</dd>
                      <dt className="text-muted">{t('liveTraffic.signal')}</dt>
                      <dd className="font-mono">
                        {Number.isFinite(selected.rssi) && Number.isFinite(selected.snr)
                          ? t('liveTraffic.signalValues', {
                              rssi: selected.rssi,
                              snr: selected.snr,
                            })
                          : t('liveTraffic.noSignal')}
                      </dd>
                      {!meshtastic && !regional && (
                        <>
                          <dt className="text-muted">{t('liveTraffic.transportScope')}</dt>
                          <dd className="font-mono">
                            {selected.scopeMixed
                              ? t('liveTraffic.mixedCodes')
                              : selected.scopeCode === null
                                ? t('liveTraffic.unscoped')
                                : scopeLabel(selected.scopeCode)}
                          </dd>
                        </>
                      )}
                    </dl>
                    {selected.routeStatus === 'estimated' && (
                      <p className="text-status-warning mt-3 text-xs">
                        {t('liveTraffic.estimatedRouteHint')}
                      </p>
                    )}
                    {selected.messageText ? (
                      <p className="text-ink-100 border-ink-800 mt-3 border-t pt-3 text-xs leading-relaxed break-words whitespace-pre-wrap">
                        {selected.messageText}
                      </p>
                    ) : packetCategory(selected.kind) === 'message' ? (
                      <p className="text-muted mt-3 text-xs">
                        {t(
                          selected.contentStatus === 'encrypted'
                            ? 'liveTraffic.encryptedContent'
                            : 'liveTraffic.contentUnavailable',
                        )}
                      </p>
                    ) : null}
                    {selected.segments.length > 0 && (
                      <div className="border-ink-800 mt-3 border-t pt-3 text-xs">
                        <p className="text-muted mb-2">
                          {t(
                            selected.routeStatus === 'estimated'
                              ? 'liveTraffic.estimatedLinks'
                              : 'liveTraffic.observedLinks',
                          )}
                        </p>
                        <ul className="space-y-1">
                          {selected.segments.slice(-12).map((segment, segmentIndex) => (
                            <li
                              key={`${segment.from.nodeId}:${segment.to.nodeId}:${segmentIndex}`}
                              className="flex items-center gap-1.5"
                            >
                              <span className="truncate">{segment.from.label}</span>
                              <ArrowRight aria-hidden className="text-muted h-3 w-3 shrink-0" />
                              <span className="truncate">{segment.to.label}</span>
                            </li>
                          ))}
                        </ul>
                        {selected.segments.length > 12 && (
                          <p className="text-muted mt-2">
                            {t('liveTraffic.additionalLinks', {
                              count: selected.segments.length - 12,
                            })}
                          </p>
                        )}
                        {selected.segments.length > LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP && (
                          <p className="text-muted mt-2">
                            {t('liveTraffic.mapLinkLimit', {
                              count: LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP,
                            })}
                          </p>
                        )}
                      </div>
                    )}
                    {selected.points.length > 0 && (
                      <div className="border-ink-800 mt-3 border-t pt-3 text-xs">
                        <p className="text-muted mb-2">{t('liveTraffic.knownLocations')}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {selected.points
                            .slice(0, MAX_INSPECTOR_LOCATIONS)
                            .map((point, position) => (
                              <span
                                key={`${point.nodeId}:${position}`}
                                className="bg-ink-800 rounded-control px-2 py-1"
                              >
                                {point.label}
                              </span>
                            ))}
                        </div>
                        {selected.points.length > MAX_INSPECTOR_LOCATIONS && (
                          <p className="text-muted mt-2">
                            {t('liveTraffic.additionalLocations', {
                              count: selected.points.length - MAX_INSPECTOR_LOCATIONS,
                            })}
                          </p>
                        )}
                      </div>
                    )}
                    {selected.routeStatus !== 'estimated' && (
                      <p className="text-muted mt-3 text-xs leading-relaxed">
                        {t(
                          meshtastic
                            ? 'liveTraffic.meshtasticInspector'
                            : 'liveTraffic.meshcoreInspector',
                        )}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
