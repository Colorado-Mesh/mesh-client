/* eslint-disable react-hooks/purity */
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import L from 'leaflet';
import { Crosshair, PARENT_HOVER_ATTR } from 'lucide-react-motion';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

import type { LocationFilter } from '../App';
import {
  formatCoordPair,
  latestPositionHistoryPoint,
  resolveNodeMapPosition,
} from '../lib/coordUtils';
import { getRoutingRowForNode, routingAnomalyNodeIds } from '../lib/diagnostics/diagnosticRows';
import { escapeSvgAttr } from '../lib/escapeSvg';
import type { OurPosition } from '../lib/gpsSource';
import { getMapOverlayColors, MAP_BASEMAPS } from '../lib/mapBasemapUtils';
import { meshcoreHwModelIsContactTypeLabel } from '../lib/meshcoreUtils';
import { NODE_BADGE_PATHS } from '../lib/nodeIcons';
import { getNodeStatus, haversineDistanceKm } from '../lib/nodeStatus';
import { useRadioProvider } from '../lib/radio/providerFactory';
import { routeWeightToColor, routeWeightToStroke } from '../lib/routeWeightUtils';
import type { MeshNode, MeshProtocol, MeshWaypoint, NodeAnomaly } from '../lib/types';
import { routingRowToNodeAnomaly } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { useMapLayerStore } from '../stores/mapLayerStore';
import { useMapViewportStore } from '../stores/mapViewportStore';
import { getWeightedPaths, usePathHistoryStore } from '../stores/pathHistoryStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import { useToast } from './Toast';

const WAYPOINT_MARKER_ICON = L.divIcon({
  className: '',
  html: `<div style="background:#f59e0b;border:2px solid #fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;">📍</div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// ─── Map styles (anomaly halos + dark popup) ──────────────────────────────────

const MAP_STYLE_ID = 'map-styles';
function ensureMapStyles() {
  if (document.getElementById(MAP_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MAP_STYLE_ID;
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

// ─── Marker icon helpers ──────────────────────────────────────────────────────

function getCUColor(cu: number): string {
  if (cu < 15) return '#22c55e';
  if (cu < 31) return '#eab308';
  if (cu < 51) return '#f97316';
  return '#ef4444';
}

/**
 * Build a Leaflet SVG marker icon.
 *
 * SECURITY: `color` and any future string parameters are interpolated into SVG
 * attribute values. Always pass internal computed values or wrap user-supplied
 * strings with `escapeSvgAttr` / `escapeSvgText` before interpolating.
 */
type NodeBadgeType = 'repeater' | 'room' | 'sensor' | 'home' | 'clock' | null;

function createMarkerIcon(
  color: string,
  isSelf: boolean,
  cu = 0,
  markerOpacity = 1,
  isMqttOnly = false,
  nodeBadge: NodeBadgeType = null,
): L.Icon {
  const haloPx = cu <= 0 ? 0 : Math.round((cu / 100) * 14);
  const haloColor = getCUColor(cu);
  const halo = (c: number) =>
    haloPx > 0
      ? `<circle cx="${c}" cy="${c}" r="${c - 0.5}" fill="${escapeSvgAttr(haloColor)}" opacity="0.4"/>`
      : '';
  const mqttBadge = (c: number) =>
    isMqttOnly
      ? `<circle cx="${c + 7}" cy="${c - 7}" r="4" fill="#3b82f6" stroke="#ffffff" stroke-width="1.5"/>`
      : '';
  const nodeBadgeSvg = (c: number) => {
    const path = nodeBadge ? NODE_BADGE_PATHS[nodeBadge] : null;
    if (!path) return '';
    return `<g><circle cx="${c - 7}" cy="${c - 7}" r="6" fill="#111827" stroke="#ffffff" stroke-width="1.2"/><path transform="translate(${c - 12},${c - 12}) scale(0.4167)" d="${path}" fill="#f9fafb"/></g>`;
  };

  if (isSelf) {
    const total = 32 + 2 * haloPx;
    const c = total / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" opacity="${markerOpacity}">${halo(c)}<g transform="translate(${haloPx},${haloPx}) scale(${32 / 24})"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${escapeSvgAttr(color)}" stroke="#ffffff" stroke-width="0.5"/></g>${mqttBadge(c)}${nodeBadgeSvg(c)}</svg>`;
    return L.icon({
      iconUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      iconSize: [total, total],
      iconAnchor: [c, c],
      popupAnchor: [0, -c],
    });
  }

  const total = 25 + 2 * haloPx;
  const c = total / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" opacity="${markerOpacity}">${halo(c)}<circle cx="${c}" cy="${c}" r="10.4" fill="${escapeSvgAttr(color)}" stroke="#ffffff" stroke-width="1" opacity="0.9"/><circle cx="${c}" cy="${c}" r="4.2" fill="#ffffff" opacity="0.8"/>${mqttBadge(c)}${nodeBadgeSvg(c)}</svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    iconSize: [total, total],
    iconAnchor: [c, c],
    popupAnchor: [0, -c],
  });
}

function getMarkerIcon(
  status: 'online' | 'stale' | 'offline',
  isSelf: boolean,
  cu: number,
  isMqttOnly = false,
  nodeBadge: 'repeater' | 'room' | 'sensor' | 'home' | 'clock' | null = null,
  isDarkBasemap = true,
): L.Icon {
  const colors = getMapOverlayColors(isDarkBasemap);
  const color = colors[status];
  const opacity = status === 'online' ? 1 : status === 'stale' ? 0.65 : 0.45;
  return createMarkerIcon(color, isSelf, cu, opacity, isMqttOnly, nodeBadge);
}

const MAX_PATH_POINTS_RENDER = 500; // Avoid huge polyline arrays in renderer memory

function downsamplePathPoints(points: [number, number][], maxPoints: number): [number, number][] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const sampled: [number, number][] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    sampled.push(points[idx]);
  }
  return sampled;
}

// ─── DiagnosticPanes ──────────────────────────────────────────────────────────
// Creates a dedicated Leaflet pane for anomaly halos. Sits above overlayPane
// (400) but below markerPane (600). The whole pane is pointer-events:none so
// animated circles never intercept clicks destined for markers.

function DiagnosticPanes() {
  const map = useMap();
  // useLayoutEffect runs synchronously after DOM commit but BEFORE any useEffect
  // fires — including the useEffect inside react-leaflet that calls layer.addTo(map).
  // This guarantees "diagnosticPane" exists when Circle layers resolve their pane.
  useLayoutEffect(() => {
    if (!map.getPane('diagnosticPane')) {
      const pane = map.createPane('diagnosticPane');
      // 650 = above markerPane (600) so halos are never clipped by it,
      // but still below tooltipPane (700) / popupPane (800).
      pane.style.zIndex = '650';
      pane.style.pointerEvents = 'none';
    }
  }, [map]);
  return null;
}

// ─── MapMarker ────────────────────────────────────────────────────────────────

/** Offset [lat, lng] in degrees for anomaly halo when multiple nodes share the same position */
interface MapMarkerProps {
  node: MeshNode;
  anomaly: NodeAnomaly | null;
  nodeRenderSignature: string;
  homeNodeRenderSignature: string;
  anomalyRenderSignature: string;
  isSelf: boolean;
  protocol: MeshProtocol;
  onNodeClick?: (nodeId: number) => void;
  congestionHalosEnabled: boolean;
  isDarkBasemap: boolean;
}

interface HaloMarkerProps {
  node: MeshNode;
  anomaly: NodeAnomaly | null;
  anomalyHalosEnabled: boolean;
  congestionHalosEnabled: boolean;
  haloCenterOffset?: [number, number];
}

const NodeHalo = memo(
  function NodeHalo({
    node,
    anomaly,
    anomalyHalosEnabled,
    congestionHalosEnabled,
    haloCenterOffset = [0, 0],
  }: HaloMarkerProps) {
    const shouldShowHalo = useMemo(
      () => anomalyHalosEnabled && anomaly !== null && anomaly.nodeId === node.node_id,
      [anomalyHalosEnabled, anomaly, node.node_id],
    );

    const severity = anomaly?.severity;
    const isError = severity === 'error';
    const isInfo = severity === 'info';

    return (
      <Fragment>
        {shouldShowHalo && !isInfo && (
          <Circle
            key={`anomaly-${node.node_id}`}
            center={[node.latitude! + haloCenterOffset[0], node.longitude! + haloCenterOffset[1]]}
            radius={500}
            pane="diagnosticPane"
            interactive={false}
            pathOptions={{
              color: isError ? '#ef4444' : '#f59e0b',
              fillColor: isError ? '#ef4444' : '#f59e0b',
              fillOpacity: 0.18,
              weight: 2,
              opacity: 0.75,
              dashArray: '8,6',
              className: isError ? 'anomaly-halo-error' : 'anomaly-halo-warning',
            }}
          />
        )}
        {shouldShowHalo && isInfo && (
          <Circle
            key={`anomaly-info-${node.node_id}`}
            center={[node.latitude! + haloCenterOffset[0], node.longitude! + haloCenterOffset[1]]}
            radius={350}
            pane="diagnosticPane"
            interactive={false}
            pathOptions={{
              color: '#60a5fa',
              fillColor: '#60a5fa',
              fillOpacity: 0.08,
              weight: 1,
              opacity: 0.5,
              dashArray: '4,8',
              className: 'anomaly-halo-info',
            }}
          />
        )}
        {congestionHalosEnabled && node.channel_utilization != null && (
          <Circle
            center={[node.latitude!, node.longitude!]}
            radius={shouldShowHalo ? 520 : 300}
            pane="diagnosticPane"
            interactive={false}
            pathOptions={{
              color: getCUColor(node.channel_utilization),
              fillColor: getCUColor(node.channel_utilization),
              fillOpacity: shouldShowHalo ? 0 : 0.25,
              weight: shouldShowHalo ? 3 : 1,
              opacity: shouldShowHalo ? 0.9 : 0.6,
            }}
          />
        )}
      </Fragment>
    );
  },
  (prev, next) =>
    prev.node === next.node &&
    prev.node.channel_utilization === next.node.channel_utilization &&
    prev.anomalyHalosEnabled === next.anomalyHalosEnabled &&
    prev.congestionHalosEnabled === next.congestionHalosEnabled &&
    prev.anomaly?.type === next.anomaly?.type &&
    prev.anomaly?.severity === next.anomaly?.severity &&
    prev.haloCenterOffset?.[0] === next.haloCenterOffset?.[0] &&
    prev.haloCenterOffset?.[1] === next.haloCenterOffset?.[1],
);

const MapMarker = memo(
  function MapMarker({
    node,
    isSelf,
    onNodeClick,
    congestionHalosEnabled,
    protocol,
    isDarkBasemap,
  }: MapMarkerProps) {
    const { nodeStaleThresholdMs, nodeOfflineThresholdMs } = useRadioProvider(protocol);
    const status = getNodeStatus(node.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs);

    const nodeBadge: 'repeater' | 'room' | 'sensor' | 'home' | 'clock' | null = (() => {
      if (node.hw_model === 'Repeater') return 'repeater';
      if (node.hw_model === 'Room') return 'room';
      if (node.hw_model === 'Sensor') return 'sensor';
      if (protocol === 'meshtastic' && node.role === 2) return 'repeater';
      if (protocol === 'meshtastic' && node.role === 11) return 'clock';
      if (protocol === 'meshtastic' && node.role === 12) return 'home';
      return null;
    })();

    const cuForIcon = congestionHalosEnabled ? (node.channel_utilization ?? 0) : 0;
    const icon = useMemo(
      () =>
        getMarkerIcon(
          status,
          isSelf,
          cuForIcon,
          node.heard_via_mqtt_only,
          nodeBadge,
          isDarkBasemap,
        ),
      [status, isSelf, cuForIcon, node.heard_via_mqtt_only, nodeBadge, isDarkBasemap],
    );

    return (
      <Marker
        position={[node.latitude!, node.longitude!]}
        icon={icon}
        zIndexOffset={isSelf ? 1000 : 0}
        eventHandlers={{
          click: () => {
            onNodeClick?.(node.node_id);
          },
        }}
      >
        {/* No popup path: map interactions route to NodeDetailModal only. */}
      </Marker>
    );
  },
  (prev, next) => {
    if (
      prev.isSelf !== next.isSelf ||
      prev.protocol !== next.protocol ||
      prev.congestionHalosEnabled !== next.congestionHalosEnabled ||
      prev.isDarkBasemap !== next.isDarkBasemap ||
      prev.onNodeClick !== next.onNodeClick ||
      prev.nodeRenderSignature !== next.nodeRenderSignature ||
      prev.homeNodeRenderSignature !== next.homeNodeRenderSignature ||
      prev.anomalyRenderSignature !== next.anomalyRenderSignature
    ) {
      return false;
    }
    // We intentionally do not re-render for unrelated `nodes` Map churn.
    return true;
  },
);

// 1941 Ute Creek Dr, Longmont CO — used when there are no GPS coordinates
const DEFAULT_CENTER: [number, number] = [40.185, -105.073];
const DEFAULT_ZOOM = 10;

// ─── MapFitter ────────────────────────────────────────────────────────────────

function MapFitter({
  positions,
  ourPosition,
  shouldFitOnMount,
}: {
  positions: [number, number][];
  ourPosition?: OurPosition | null;
  shouldFitOnMount: boolean;
}) {
  const map = useMap();
  const hasPerformedInitialFitRef = useRef(false);
  useEffect(() => {
    if (!shouldFitOnMount) return;
    if (!hasPerformedInitialFitRef.current) {
      hasPerformedInitialFitRef.current = true;
      const center: [number, number] =
        positions.length > 0
          ? positions[0]
          : ourPosition
            ? [ourPosition.lat, ourPosition.lon]
            : DEFAULT_CENTER;
      map.setView(center, DEFAULT_ZOOM);
    }
  }, [positions, ourPosition, map, shouldFitOnMount]);
  return null;
}

// ─── ViewportSaver ────────────────────────────────────────────────────────────
// Only save viewport when we have position data, so that when data arrives
// later we still perform the initial fit once instead of staying at default.

const VIEWPORT_EPS = 1e-6;

function ViewportSaver({ hasAnyPositions }: { hasAnyPositions: boolean }) {
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

// ─── LocateMeControl ──────────────────────────────────────────────────────────

function LocateMeControl({
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
            onClick={handleLocate}
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
      {locatedPos && (
        <CircleMarker
          center={locatedPos}
          radius={8}
          pathOptions={{ color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }}
        />
      )}
    </>
  );
}

function PathPolyline({
  nodeId,
  pathPositions,
  pathOptions,
  onNodeClick,
}: {
  nodeId: number;
  pathPositions: [number, number][];
  pathOptions: { color: string; weight: number; opacity: number };
  onNodeClick?: (nodeId: number) => void;
}) {
  const map = useMap();

  return (
    <Polyline
      key={`path-${nodeId}`}
      positions={pathPositions}
      pathOptions={pathOptions}
      eventHandlers={{
        click: () => {
          const latestPoint = pathPositions[pathPositions.length - 1];
          if (latestPoint) {
            const targetZoom = Math.max(map.getZoom(), 13);
            map.flyTo(latestPoint, targetZoom, { duration: 0.35 });
          }
          onNodeClick?.(nodeId);
        },
      }}
    />
  );
}

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

function MapLayerControl({
  routeWeightsSupported,
  showRouteWeights,
  onToggleRouteWeights,
}: {
  routeWeightsSupported: boolean;
  showRouteWeights: boolean;
  onToggleRouteWeights: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const layersPanelOpen = useMapLayerStore((s) => s.layersPanelOpen);
  const setLayersPanelOpen = useMapLayerStore((s) => s.setLayersPanelOpen);
  const basemapId = useMapLayerStore((s) => s.basemapId);
  const setBasemapId = useMapLayerStore((s) => s.setBasemapId);
  const showNodes = useMapLayerStore((s) => s.showNodes);
  const setShowNodes = useMapLayerStore((s) => s.setShowNodes);
  const showWaypoints = useMapLayerStore((s) => s.showWaypoints);
  const setShowWaypoints = useMapLayerStore((s) => s.setShowWaypoints);
  const showPaths = usePositionHistoryStore((s) => s.showPaths);
  const setShowPaths = usePositionHistoryStore((s) => s.setShowPaths);
  const anomalyHalosEnabled = useDiagnosticsStore((s) => s.anomalyHalosEnabled);
  const setAnomalyHalosEnabled = useDiagnosticsStore((s) => s.setAnomalyHalosEnabled);
  const congestionHalosEnabled = useDiagnosticsStore((s) => s.congestionHalosEnabled);
  const setCongestionHalosEnabled = useDiagnosticsStore((s) => s.setCongestionHalosEnabled);

  const layerRow = (
    id: string,
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <label key={id} className="text-muted flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        className="accent-brand-green"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      {label}
    </label>
  );

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
      {layersPanelOpen && (
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
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
              {t('mapPanel.layersHeading')}
            </div>
            {layerRow('nodes', t('mapPanel.layerNodes'), showNodes, setShowNodes)}
            {layerRow('paths', t('mapPanel.layerPaths'), showPaths, setShowPaths)}
            {layerRow('waypoints', t('mapPanel.layerWaypoints'), showWaypoints, setShowWaypoints)}
            {routeWeightsSupported &&
              layerRow(
                'routeWeights',
                t('mapPanel.layerRouteWeights'),
                showRouteWeights,
                onToggleRouteWeights,
              )}
            {layerRow(
              'anomalyHalos',
              t('mapPanel.layerAnomalyHalos'),
              anomalyHalosEnabled,
              setAnomalyHalosEnabled,
            )}
            {layerRow(
              'congestionHalos',
              t('mapPanel.layerCongestionHalos'),
              congestionHalosEnabled,
              setCongestionHalosEnabled,
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MapPanel ─────────────────────────────────────────────────────────────────

interface Props {
  nodes: Map<number, MeshNode>;
  myNodeNum: number;
  locationFilter: LocationFilter;
  ourPosition?: OurPosition | null;
  onLocateMe?: () => Promise<{ lat: number; lon: number } | null>;
  waypoints?: Map<number, MeshWaypoint>;
  onSendWaypoint?: (
    wp: Omit<MeshWaypoint, 'from' | 'timestamp'>,
    dest?: number,
    ch?: number,
  ) => Promise<void>;
  onDeleteWaypoint?: (id: number) => Promise<void>;
  onNodeClick?: (nodeId: number) => void;
  protocol?: MeshProtocol;
}

export default function MapPanel({
  nodes,
  myNodeNum,
  locationFilter,
  ourPosition,
  onLocateMe,
  waypoints,
  onDeleteWaypoint,
  onNodeClick,
  protocol = 'meshtastic',
}: Props) {
  const { t } = useTranslation();
  const toNodeRenderSignature = useCallback((node: MeshNode): string => {
    return [
      node.node_id,
      node.latitude ?? 'null',
      node.longitude ?? 'null',
      node.long_name ?? '',
      node.short_name ?? '',
      node.hw_model ?? '',
      node.role ?? 'null',
      node.battery ?? 'null',
      node.voltage ?? 'null',
      node.snr ?? 'null',
      node.rssi ?? 'null',
      node.last_heard ?? 'null',
      node.hops_away ?? 'null',
      node.channel_utilization ?? 'null',
      node.air_util_tx ?? 'null',
      node.heard_via_mqtt_only ? 1 : 0,
      node.heard_via_mqtt ? 1 : 0,
      node.lastPositionWarning ?? '',
      node.favorited ? 1 : 0,
    ].join('|');
  }, []);
  const toAnomalyRenderSignature = useCallback((anomaly: NodeAnomaly | null): string => {
    if (anomaly == null) return 'none';
    return [
      anomaly.nodeId,
      anomaly.type,
      anomaly.severity,
      anomaly.description,
      anomaly.detectedAt,
      anomaly.confidence ?? 'none',
    ].join('|');
  }, []);
  const homeNode = nodes.get(myNodeNum) ?? null;
  const { nodeStaleThresholdMs, nodeOfflineThresholdMs } = useRadioProvider(protocol);
  const excludeMeshcoreContactTypesInMeshtastic = protocol === 'meshtastic';

  const congestionHalosEnabled = useDiagnosticsStore((s) => s.congestionHalosEnabled);
  const anomalyHalosEnabled = useDiagnosticsStore((s) => s.anomalyHalosEnabled);
  const diagnosticRows = useDiagnosticsStore((s) => s.diagnosticRows);
  const routingNodeIds = useMemo(() => routingAnomalyNodeIds(diagnosticRows), [diagnosticRows]);

  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const positionHistory = usePositionHistoryStore((s) => s.history);
  const pathRecords = usePathHistoryStore((s) => s.records);
  const loadPathHistoryForNode = usePathHistoryStore((s) => s.loadForNode);
  const showPaths = usePositionHistoryStore((s) => s.showPaths);
  const loadHistoryFromDb = usePositionHistoryStore((s) => s.loadHistoryFromDb);

  const basemapId = useMapLayerStore((s) => s.basemapId);
  const showNodes = useMapLayerStore((s) => s.showNodes);
  const showWaypoints = useMapLayerStore((s) => s.showWaypoints);
  const basemap = MAP_BASEMAPS[basemapId];
  const overlayColors = useMemo(() => getMapOverlayColors(basemap.isDark), [basemap.isDark]);

  const [showRouteWeights, setShowRouteWeights] = useState(false);
  const routeWeightLoadedNodeIdsRef = useRef<Set<number>>(new Set());
  const routeWeightsSupported = protocol === 'meshcore';

  const routeWeightPolylines = useMemo(() => {
    if (!showNodes || !routeWeightsSupported || !showRouteWeights) return null;
    const paths = getWeightedPaths(pathRecords);

    const homeNodeForRoute = myNodeNum ? nodes.get(myNodeNum) : undefined;
    const hasHomeGps =
      homeNodeForRoute?.latitude != null &&
      homeNodeForRoute?.longitude != null &&
      (Math.abs(homeNodeForRoute.latitude) > 0.0001 ||
        Math.abs(homeNodeForRoute.longitude) > 0.0001);
    const fromPos: [number, number] | null = hasHomeGps
      ? [homeNodeForRoute.latitude!, homeNodeForRoute.longitude!]
      : ourPosition
        ? [ourPosition.lat, ourPosition.lon]
        : null;

    if (!fromPos) {
      return null;
    }

    const validPaths = paths.flatMap((p) => {
      const toNode = nodes.get(p.nodeId);
      if (!toNode?.latitude || !toNode?.longitude) return [];
      return [{ ...p, fromPos, toPos: [toNode.latitude, toNode.longitude] as [number, number] }];
    });

    if (validPaths.length > 0) {
      const maxWeight = Math.max(...validPaths.map((p) => p.routeWeight), 1);
      if (!Number.isFinite(maxWeight) || maxWeight <= 0) {
        return null;
      }

      return validPaths.map((p) => (
        <Polyline
          key={`rw-${p.nodeId}`}
          positions={[p.fromPos, p.toPos] as [[number, number], [number, number]]}
          pathOptions={{
            color: routeWeightToColor(p.routeWeight, maxWeight),
            weight: routeWeightToStroke(p.routeWeight, maxWeight),
            opacity: 0.7,
          }}
        />
      ));
    }

    // No path-history rows: MeshCore often reports outPathLen=0 on contacts, so store stays empty.
    // Fallback: thickness from hops_away (fewer hops → thicker line), same color scale.
    const fallbackPeers = Array.from(nodes.values()).filter((n) => {
      if (myNodeNum && n.node_id === myNodeNum) return false;
      if (n.latitude == null || n.longitude == null) return false;
      if (!(Math.abs(n.latitude) > 0.0001 || Math.abs(n.longitude) > 0.0001)) return false;
      return n.hops_away != null && Number.isFinite(n.hops_away) && n.hops_away >= 0;
    });
    if (fallbackPeers.length === 0) {
      return null;
    }

    const weights = fallbackPeers.map((n) => {
      const h = Math.min(7, Math.max(0, n.hops_away ?? 0));
      return 8 - h;
    });
    const maxWeight = Math.max(...weights, 1);

    return fallbackPeers.map((n, i) => {
      const w = weights[i];
      const toPos: [number, number] = [n.latitude!, n.longitude!];
      return (
        <Polyline
          key={`rw-hops-${n.node_id}`}
          positions={[fromPos, toPos] as [[number, number], [number, number]]}
          pathOptions={{
            color: routeWeightToColor(w, maxWeight),
            weight: routeWeightToStroke(w, maxWeight),
            opacity: 0.7,
          }}
        />
      );
    });
  }, [
    showNodes,
    routeWeightsSupported,
    showRouteWeights,
    pathRecords,
    myNodeNum,
    nodes,
    ourPosition,
  ]);

  useEffect(() => {
    ensureMapStyles();
    void loadHistoryFromDb().catch((e: unknown) => {
      console.warn('[MapPanel] loadHistoryFromDb failed:', String(e));
    });
  }, [loadHistoryFromDb]);

  useEffect(() => {
    if (!routeWeightsSupported || !showRouteWeights) return;
    const nodeIdsToLoad = Array.from(nodes.keys()).filter(
      (nodeId) => !routeWeightLoadedNodeIdsRef.current.has(nodeId),
    );
    if (nodeIdsToLoad.length === 0) return;

    nodeIdsToLoad.forEach((nodeId) => {
      routeWeightLoadedNodeIdsRef.current.add(nodeId);
      void loadPathHistoryForNode(nodeId).catch((e: unknown) => {
        console.warn('[MapPanel] load path history for node failed:', String(e));
      });
    });
  }, [routeWeightsSupported, showRouteWeights, nodes, loadPathHistoryForNode, pathRecords.size]);

  const nodesWithPosition = useMemo(() => {
    const homeNode = myNodeNum ? nodes.get(myNodeNum) : undefined;
    const homeHasLocation =
      homeNode?.latitude != null &&
      homeNode.latitude !== 0 &&
      homeNode.longitude != null &&
      homeNode.longitude !== 0;
    const maxKm =
      locationFilter.unit === 'miles'
        ? locationFilter.maxDistance * 1.60934
        : locationFilter.maxDistance;

    return Array.from(nodes.values())
      .flatMap((n) => {
        const displayPos =
          n.node_id === myNodeNum && ourPosition?.source === 'static'
            ? { lat: ourPosition.lat, lon: ourPosition.lon }
            : resolveNodeMapPosition(n, latestPositionHistoryPoint(positionHistory.get(n.node_id)));
        if (!displayPos) return [];
        const mapped: MeshNode = { ...n, latitude: displayPos.lat, longitude: displayPos.lon };
        if (
          excludeMeshcoreContactTypesInMeshtastic &&
          meshcoreHwModelIsContactTypeLabel(mapped.hw_model)
        ) {
          return [];
        }
        if (locationFilter.hideMqttOnly && mapped.heard_via_mqtt_only) {
          return [];
        }
        if (locationFilter.enabled && homeHasLocation) {
          const d = haversineDistanceKm(
            homeNode?.latitude ?? 0,
            homeNode?.longitude ?? 0,
            mapped.latitude!,
            mapped.longitude!,
          );
          if (d > maxKm) return [];
        }
        return [mapped];
      })
      .sort((a, b) => a.node_id - b.node_id);
  }, [
    nodes,
    myNodeNum,
    locationFilter,
    excludeMeshcoreContactTypesInMeshtastic,
    positionHistory,
    ourPosition,
  ]);
  const nodesToRender = useMemo(() => {
    const idSet = new Set(nodesWithPosition.map((n) => n.node_id));
    const out: MeshNode[] = [...nodesWithPosition];
    for (const nodeId of routingNodeIds) {
      if (idSet.has(nodeId)) continue;
      const node = nodes.get(nodeId);
      if (
        excludeMeshcoreContactTypesInMeshtastic &&
        meshcoreHwModelIsContactTypeLabel(node?.hw_model)
      ) {
        continue;
      }
      const displayPos = node
        ? resolveNodeMapPosition(node, latestPositionHistoryPoint(positionHistory.get(nodeId)))
        : null;
      if (!node || !displayPos) continue;
      idSet.add(nodeId);
      out.push({ ...node, latitude: displayPos.lat, longitude: displayPos.lon });
    }
    return out.sort((a, b) => a.node_id - b.node_id);
  }, [
    nodesWithPosition,
    routingNodeIds,
    nodes,
    excludeMeshcoreContactTypesInMeshtastic,
    positionHistory,
  ]);

  const nodesWithStatus = useMemo(
    () =>
      nodesToRender.map((node) => {
        const routingRow = getRoutingRowForNode(diagnosticRows, node.node_id);
        const anomaly: NodeAnomaly | null = routingRow ? routingRowToNodeAnomaly(routingRow) : null;
        return { node, anomaly };
      }),
    [nodesToRender, diagnosticRows],
  );

  const nodesWithStatusAndHaloOffset = useMemo(() => {
    const withAnomaly = nodesWithStatus.filter((x) => x.anomaly != null);
    const byPos = new Map<string, typeof withAnomaly>();
    for (const item of withAnomaly) {
      const k = `${item.node.latitude},${item.node.longitude}`;
      if (!byPos.has(k)) byPos.set(k, []);
      byPos.get(k)!.push(item);
    }
    const offsetByNodeId = new Map<number, [number, number]>();
    for (const group of byPos.values()) {
      group.forEach((item, i) => {
        const row = Math.floor(i / 2),
          col = i % 2;
        offsetByNodeId.set(item.node.node_id, [col * 0.0002, row * 0.0002]);
      });
    }
    return nodesWithStatus.map(({ node, anomaly }) => ({
      node,
      anomaly,
      haloCenterOffset: anomaly != null ? (offsetByNodeId.get(node.node_id) ?? [0, 0]) : undefined,
    }));
  }, [nodesWithStatus]);

  const selfInNodesToRender = useMemo(
    () => nodesToRender.some((n) => n.node_id === myNodeNum),
    [nodesToRender, myNodeNum],
  );

  const selfFallbackNode = useMemo<MeshNode | null>(() => {
    if (selfInNodesToRender || !ourPosition) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const longName = homeNode?.long_name || `Node-${myNodeNum.toString(16).toUpperCase()}`;
    return {
      node_id: myNodeNum,
      long_name: longName,
      short_name:
        protocol === 'meshcore'
          ? (homeNode?.short_name ?? '')
          : homeNode?.short_name || longName.slice(0, 4),
      hw_model: homeNode?.hw_model ?? 'Unknown',
      battery: homeNode?.battery ?? 0,
      snr: homeNode?.snr ?? 0,
      rssi: homeNode?.rssi ?? 0,
      last_heard: homeNode?.last_heard ?? nowSec,
      latitude: ourPosition.lat,
      longitude: ourPosition.lon,
      favorited: homeNode?.favorited ?? false,
      heard_via_mqtt_only: homeNode?.heard_via_mqtt_only,
      channel_utilization: homeNode?.channel_utilization,
    };
  }, [selfInNodesToRender, ourPosition, homeNode, myNodeNum, protocol]);

  const nodesWithStatusAndHaloOffsetForRender = useMemo(() => {
    if (!selfFallbackNode) return nodesWithStatusAndHaloOffset;
    return [
      ...nodesWithStatusAndHaloOffset,
      {
        node: selfFallbackNode,
        anomaly: null,
        haloCenterOffset: undefined,
      },
    ];
  }, [nodesWithStatusAndHaloOffset, selfFallbackNode]);

  const positions = useMemo<[number, number][]>(() => {
    const base = nodesToRender.map((n) => [n.latitude!, n.longitude!] as [number, number]);
    if (selfFallbackNode) base.push([selfFallbackNode.latitude!, selfFallbackNode.longitude!]);
    return base;
  }, [nodesToRender, selfFallbackNode]);

  const movingNodePaths = useMemo(() => {
    if (!showPaths) return [];
    const result: {
      nodeId: number;
      positions: [number, number][];
      pathOptions: { color: string; weight: number; opacity: number };
    }[] = [];
    for (const [nodeId, points] of positionHistory) {
      if (points.length < 2) continue;
      const node = nodes.get(nodeId);
      if (!node) continue;
      const status = getNodeStatus(node.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs);
      result.push({
        nodeId,
        positions: downsamplePathPoints(
          points.map((p) => [p.lat, p.lon] as [number, number]),
          MAX_PATH_POINTS_RENDER,
        ),
        pathOptions: { color: overlayColors[status], weight: 3, opacity: 0.65 },
      });
    }
    return result;
  }, [
    positionHistory,
    showPaths,
    nodes,
    nodeStaleThresholdMs,
    nodeOfflineThresholdMs,
    overlayColors,
  ]);

  const savedViewport = useMapViewportStore((s) => s.viewport);
  const computedCenter: [number, number] =
    nodesToRender.length > 0
      ? [nodesToRender[0].latitude!, nodesToRender[0].longitude!]
      : ourPosition
        ? [ourPosition.lat, ourPosition.lon]
        : DEFAULT_CENTER;
  const computedZoom = DEFAULT_ZOOM;
  const shouldFitOnMount = savedViewport == null;

  const [initialViewport] = useState(() => ({
    center: savedViewport?.center ?? computedCenter,
    zoom: savedViewport?.zoom ?? computedZoom,
  }));

  const statusCounts = useMemo(() => {
    const counts = { online: 0, stale: 0, offline: 0 };
    for (const n of nodesToRender) {
      counts[getNodeStatus(n.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs)]++;
    }
    return counts;
  }, [nodesToRender, nodeStaleThresholdMs, nodeOfflineThresholdMs]);

  const denseMapMarkers = nodesToRender.length > 200;

  const iconCreateFunction = useCallback(
    (cluster: { getChildCount(): number }) => {
      const count = cluster.getChildCount();
      let size = 40;
      if (count > 10) size = 50;
      if (count > 100) size = 60;
      const border = overlayColors.online;
      const fill = basemap.isDark ? overlayColors.online : '#15803d';
      const text = basemap.isDark ? '#020617' : '#ffffff';
      return L.divIcon({
        html: `<div style="background:${border}33;border:3px solid ${border};border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;"><span style="display:inline-flex;align-items:center;justify-content:center;padding:0 4px;min-width:18px;height:18px;border-radius:9999px;background:${fill};color:${text};font-size:12px;font-weight:800;line-height:1;opacity:1;">${count}</span></div>`,
        className: '',
        iconSize: [size, size],
      });
    },
    [overlayColors.online, basemap.isDark],
  );

  return (
    <div
      className="relative h-full min-h-[500px] overflow-hidden rounded-lg border border-gray-700/50"
      aria-label={t('mapPanel.networkMap')}
    >
      {/* Status legend + layer controls — top right, below Leaflet zoom (+/-) on the left */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2">
        <div className="bg-deep-black/80 flex items-center gap-3 rounded-lg border border-gray-700 px-3 py-1.5 text-xs backdrop-blur-sm">
          <span className="flex items-center gap-1">
            <span className="bg-brand-green inline-block h-2 w-2 rounded-full" />
            {statusCounts.online}
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: overlayColors.stale }}
            />
            {statusCounts.stale}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-slate-700" />
            {statusCounts.offline}
          </span>
        </div>
        <MapLayerControl
          routeWeightsSupported={routeWeightsSupported}
          showRouteWeights={showRouteWeights}
          onToggleRouteWeights={setShowRouteWeights}
        />
      </div>

      <MapContainer
        center={initialViewport.center}
        zoom={initialViewport.zoom}
        className="absolute inset-0"
        preferCanvas
      >
        <DiagnosticPanes />
        <ViewportSaver hasAnyPositions={positions.length > 0 || !!ourPosition} />
        <MapFocusController />
        <MapFitter
          positions={positions}
          ourPosition={ourPosition}
          shouldFitOnMount={shouldFitOnMount}
        />
        <LocateMeControl onLocateMe={onLocateMe} />
        <TileLayer
          key={basemapId}
          url={basemap.url}
          attribution={basemap.attribution}
          keepBuffer={1}
          updateWhenIdle
        />
        {movingNodePaths.map(({ nodeId, positions: pathPositions, pathOptions }) => (
          <PathPolyline
            key={`path-${nodeId}`}
            nodeId={nodeId}
            pathPositions={pathPositions}
            pathOptions={pathOptions}
            onNodeClick={onNodeClick}
          />
        ))}
        {routeWeightPolylines}
        {showNodes && (anomalyHalosEnabled || congestionHalosEnabled)
          ? nodesWithStatusAndHaloOffsetForRender.map(({ node, anomaly, haloCenterOffset }) => (
              <NodeHalo
                key={`halo-${node.node_id}`}
                node={node}
                anomaly={anomaly}
                anomalyHalosEnabled={anomalyHalosEnabled}
                congestionHalosEnabled={congestionHalosEnabled}
                haloCenterOffset={haloCenterOffset}
              />
            ))
          : null}
        {showNodes && (
          <MarkerClusterGroup
            showCoverageOnHover={false}
            chunkedLoading
            maxClusterRadius={denseMapMarkers ? 80 : 60}
            disableClusteringAtZoom={denseMapMarkers ? 12 : 9}
            iconCreateFunction={iconCreateFunction}
          >
            {nodesWithStatusAndHaloOffsetForRender.map(({ node, anomaly }) => (
              <MapMarker
                key={node.node_id}
                node={node}
                anomaly={anomaly}
                nodeRenderSignature={toNodeRenderSignature(node)}
                homeNodeRenderSignature={homeNode ? toNodeRenderSignature(homeNode) : 'none'}
                anomalyRenderSignature={toAnomalyRenderSignature(anomaly)}
                isSelf={node.node_id === myNodeNum}
                protocol={protocol}
                onNodeClick={onNodeClick}
                congestionHalosEnabled={congestionHalosEnabled}
                isDarkBasemap={basemap.isDark}
              />
            ))}
          </MarkerClusterGroup>
        )}
        {showWaypoints &&
          waypoints &&
          [...waypoints.values()].map((wp) => (
            <Marker key={wp.id} position={[wp.latitude, wp.longitude]} icon={WAYPOINT_MARKER_ICON}>
              <Popup>
                <div className="space-y-1 p-2">
                  <div className="text-sm font-medium text-gray-100">{wp.name || 'Waypoint'}</div>
                  {wp.description && <div className="text-xs text-gray-400">{wp.description}</div>}
                  <div className="font-mono text-xs text-gray-500">
                    {formatCoordPair(wp.latitude, wp.longitude, coordinateFormat)}
                  </div>
                  {onDeleteWaypoint && (
                    <button
                      onClick={() => onDeleteWaypoint(wp.id)}
                      className="mt-1 w-full rounded border border-red-800/50 bg-red-900/40 px-2 py-1 text-xs text-red-300 transition-colors hover:bg-red-900/60"
                    >
                      Delete Waypoint
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
      </MapContainer>

      {nodesToRender.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="bg-deep-black/80 text-muted rounded-lg px-4 py-2 text-sm">
            No nodes with GPS positions yet
          </div>
        </div>
      )}
    </div>
  );
}
