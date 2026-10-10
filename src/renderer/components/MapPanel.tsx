/* eslint-disable react-hooks/purity */
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import L from 'leaflet';
import { Download } from 'lucide-react-motion';
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
import { Circle, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';

import type { LocationFilter } from '../App';
import {
  formatCoordPair,
  latestPositionHistoryPoint,
  resolveNodeMapPosition,
} from '../lib/coordUtils';
import { getRoutingRowForNode, routingAnomalyNodeIds } from '../lib/diagnostics/diagnosticRows';
import { isMapSensorMetric } from '../lib/environmentSensorDisplay';
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
import { EnvironmentSensorLayer } from './map/environmentSensorLayer';
import { ensureLoRaMapPanelStyles } from './map/leafletMapControls';
import { MAP_CHIP_CLASS, MAP_CONTROL_CLASS } from './map/mapControlClasses';
import { MapLayerRow } from './map/MapLayerControl';
import { MeshMapShell } from './map/MeshMapShell';
import { TakContactsLayer } from './map/takContactsLayer';
import { useToast } from './Toast';
import { buttonClassName } from './ui/Button';
import { SELECT_BOX_SM_CLASS } from './ui/formClasses';

const WAYPOINT_MARKER_ICON = L.divIcon({
  className: '',
  html: `<div style="background:#f59e0b;border:2px solid #fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;color:#fff;"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// ─── Map styles (anomaly halos + dark popup) — see ensureLoRaMapPanelStyles in leafletMapControls ─

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
    return `<g><circle cx="${c - 7}" cy="${c - 7}" r="6" fill="#292929" stroke="#ffffff" stroke-width="1.2"/><path transform="translate(${c - 12},${c - 12}) scale(0.4167)" d="${path}" fill="#f9fafb"/></g>`;
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

// ─── PathPolyline ─────────────────────────────────────────────────────────────

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

function LoRaMapLayerRows({
  routeWeightsSupported,
  showRouteWeights,
  onToggleRouteWeights,
  sensorsSupported,
  takSupported,
}: {
  routeWeightsSupported: boolean;
  showRouteWeights: boolean;
  onToggleRouteWeights: (enabled: boolean) => void;
  sensorsSupported: boolean;
  takSupported: boolean;
}) {
  const { t } = useTranslation();
  const showNodes = useMapLayerStore((s) => s.showNodes);
  const setShowNodes = useMapLayerStore((s) => s.setShowNodes);
  const showWaypoints = useMapLayerStore((s) => s.showWaypoints);
  const setShowWaypoints = useMapLayerStore((s) => s.setShowWaypoints);
  const showSensors = useMapLayerStore((s) => s.showSensors);
  const setShowSensors = useMapLayerStore((s) => s.setShowSensors);
  const sensorMetric = useMapLayerStore((s) => s.sensorMetric);
  const setSensorMetric = useMapLayerStore((s) => s.setSensorMetric);
  const showTakContacts = useMapLayerStore((s) => s.showTakContacts);
  const setShowTakContacts = useMapLayerStore((s) => s.setShowTakContacts);
  const showPaths = usePositionHistoryStore((s) => s.showPaths);
  const setShowPaths = usePositionHistoryStore((s) => s.setShowPaths);
  const anomalyHalosEnabled = useDiagnosticsStore((s) => s.anomalyHalosEnabled);
  const setAnomalyHalosEnabled = useDiagnosticsStore((s) => s.setAnomalyHalosEnabled);
  const congestionHalosEnabled = useDiagnosticsStore((s) => s.congestionHalosEnabled);
  const setCongestionHalosEnabled = useDiagnosticsStore((s) => s.setCongestionHalosEnabled);

  return (
    <>
      <MapLayerRow label={t('mapPanel.layerNodes')} checked={showNodes} onChange={setShowNodes} />
      <MapLayerRow label={t('mapPanel.layerPaths')} checked={showPaths} onChange={setShowPaths} />
      <MapLayerRow
        label={t('mapPanel.layerWaypoints')}
        checked={showWaypoints}
        onChange={setShowWaypoints}
      />
      {takSupported ? (
        <MapLayerRow
          label={t('mapPanel.layerTakContacts')}
          checked={showTakContacts}
          onChange={setShowTakContacts}
        />
      ) : null}
      {sensorsSupported ? (
        <MapLayerRow
          label={t('sensorLayer.layer')}
          checked={showSensors}
          onChange={setShowSensors}
        />
      ) : null}
      {sensorsSupported && showSensors ? (
        <select
          aria-label={t('sensorLayer.metricSelectAria')}
          className={`${SELECT_BOX_SM_CLASS} w-full`}
          value={sensorMetric}
          onChange={(e) => {
            const v = e.target.value;
            if (isMapSensorMetric(v)) setSensorMetric(v);
          }}
        >
          <option value="temperature">{t('sensorLayer.metricTemperature')}</option>
          <option value="relativeHumidity">{t('sensorLayer.metricHumidity')}</option>
          <option value="barometricPressure">{t('sensorLayer.metricPressure')}</option>
        </select>
      ) : null}
      {routeWeightsSupported ? (
        <MapLayerRow
          label={t('mapPanel.layerRouteWeights')}
          checked={showRouteWeights}
          onChange={onToggleRouteWeights}
        />
      ) : null}
      <MapLayerRow
        label={t('mapPanel.layerAnomalyHalos')}
        checked={anomalyHalosEnabled}
        onChange={setAnomalyHalosEnabled}
      />
      <MapLayerRow
        label={t('mapPanel.layerCongestionHalos')}
        checked={congestionHalosEnabled}
        onChange={setCongestionHalosEnabled}
      />
    </>
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
  /** Opens the node that posted a weather forecast (may be on another protocol). */
  onForecastSenderClick?: (protocol: MeshProtocol, senderId: number) => void;
  protocol?: MeshProtocol;
  useFahrenheit?: boolean;
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
  onForecastSenderClick,
  protocol = 'meshtastic',
  useFahrenheit = false,
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
  const { nodeStaleThresholdMs, nodeOfflineThresholdMs, hasEnvironmentTelemetry, hasTakPanel } =
    useRadioProvider(protocol);
  const excludeMeshcoreContactTypesInMeshtastic = protocol === 'meshtastic';

  const congestionHalosEnabled = useDiagnosticsStore((s) => s.congestionHalosEnabled);
  const anomalyHalosEnabled = useDiagnosticsStore((s) => s.anomalyHalosEnabled);
  const diagnosticRows = useDiagnosticsStore((s) => s.diagnosticRows);
  const protocolDiagnosticRows = diagnosticRows;
  const routingNodeIds = useMemo(
    () => routingAnomalyNodeIds(protocolDiagnosticRows),
    [protocolDiagnosticRows],
  );

  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const positionHistory = usePositionHistoryStore((s) => s.history);
  const pathRecords = usePathHistoryStore((s) => s.records);
  const loadPathHistoryForNode = usePathHistoryStore((s) => s.loadForNode);
  const showPaths = usePositionHistoryStore((s) => s.showPaths);
  const loadHistoryFromDb = usePositionHistoryStore((s) => s.loadHistoryFromDb);

  const basemapId = useMapLayerStore((s) => s.basemapId);
  const showNodes = useMapLayerStore((s) => s.showNodes);
  const showWaypoints = useMapLayerStore((s) => s.showWaypoints);
  const showSensors = useMapLayerStore((s) => s.showSensors);
  const sensorMetric = useMapLayerStore((s) => s.sensorMetric);
  const showTakContacts = useMapLayerStore((s) => s.showTakContacts);
  const basemap = MAP_BASEMAPS[basemapId];
  const overlayColors = useMemo(() => getMapOverlayColors(basemap.isDark), [basemap.isDark]);

  const [showRouteWeights, setShowRouteWeights] = useState(false);
  const [gpxExporting, setGpxExporting] = useState(false);
  const { addToast } = useToast();
  const routeWeightLoadedNodeIdsRef = useRef<Set<number>>(new Set());
  const routeWeightsSupported = protocol === 'meshcore';

  const handleExportGpx = useCallback(async () => {
    if (gpxExporting) return;
    setGpxExporting(true);
    try {
      // The GPS bridge is absent outside Electron (browser preview, chaos runs);
      // surface the normal failure toast instead of throwing on an undefined namespace.
      const exportGpx = window.electronAPI?.gps?.exportGpx;
      if (!exportGpx) {
        addToast(t('gpxExport.failed'), 'error');
        return;
      }
      const result = await exportGpx({ sinceMs: 0 });
      if (result.success) {
        addToast(t('gpxExport.success'), 'success');
      } else if (result.reason === 'empty') {
        addToast(t('gpxExport.empty'), 'error');
      } else if (result.reason === 'cancelled') {
        // catch-no-log-ok user dismissed save dialog
      } else {
        addToast(t('gpxExport.failed'), 'error');
      }
    } catch (err) {
      console.error('[MapPanel] GPX export failed', err);
      addToast(t('gpxExport.failed'), 'error');
    } finally {
      setGpxExporting(false);
    }
  }, [addToast, gpxExporting, t]);

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
    ensureLoRaMapPanelStyles();
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
        const routingRow = getRoutingRowForNode(protocolDiagnosticRows, node.node_id);
        const anomaly: NodeAnomaly | null = routingRow ? routingRowToNodeAnomaly(routingRow) : null;
        return { node, anomaly };
      }),
    [nodesToRender, protocolDiagnosticRows],
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
      const text = basemap.isDark ? '#1b1b1b' : '#ffffff';
      return L.divIcon({
        html: `<div style="background:${border}33;border:3px solid ${border};border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;"><span style="display:inline-flex;align-items:center;justify-content:center;padding:0 4px;min-width:18px;height:18px;border-radius:9999px;background:${fill};color:${text};font-size:12px;font-weight:800;line-height:1;opacity:1;">${count}</span></div>`,
        className: '',
        iconSize: [size, size],
      });
    },
    [overlayColors.online, basemap.isDark],
  );

  const ourFallbackPoint = useMemo<[number, number] | null>(
    () => (ourPosition ? [ourPosition.lat, ourPosition.lon] : null),
    [ourPosition],
  );

  return (
    <MeshMapShell
      ariaLabel={t('mapPanel.networkMap')}
      frameClassName="h-full min-h-[500px]"
      initialCenter={initialViewport.center}
      initialZoom={initialViewport.zoom}
      defaultCenter={DEFAULT_CENTER}
      defaultZoom={DEFAULT_ZOOM}
      fit={{
        mode: 'firstPoint',
        points: positions,
        fallbackPoint: ourFallbackPoint,
        shouldFitOnMount,
      }}
      hasAnyPositions={positions.length > 0 || !!ourPosition}
      onLocateMe={onLocateMe}
      onForecastSenderClick={onForecastSenderClick}
      controlsBefore={
        <div className={MAP_CHIP_CLASS}>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
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
            <span className="bg-ink-700 inline-block h-2 w-2 rounded-full" />
            {statusCounts.offline}
          </span>
        </div>
      }
      controlsAfter={
        <button
          type="button"
          onClick={() => void handleExportGpx()}
          disabled={gpxExporting}
          aria-label={t('gpxExport.buttonAria')}
          className={MAP_CONTROL_CLASS}
        >
          <Download aria-hidden className="h-3.5 w-3.5" />
          {t('gpxExport.button')}
        </button>
      }
      layerRows={
        <LoRaMapLayerRows
          routeWeightsSupported={routeWeightsSupported}
          showRouteWeights={showRouteWeights}
          onToggleRouteWeights={setShowRouteWeights}
          sensorsSupported={hasEnvironmentTelemetry}
          takSupported={hasTakPanel}
        />
      }
      beforeTiles={<DiagnosticPanes />}
      overlay={
        nodesToRender.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="bg-deep-black/80 text-muted rounded-lg px-4 py-2 text-sm">
              {t('mapPanel.noGpsNodes')}
            </div>
          </div>
        ) : null
      }
    >
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
                <div className="text-ink-100 text-sm font-medium">
                  {wp.name || t('mapPanel.waypointDefaultName')}
                </div>
                {wp.description && <div className="text-ink-400 text-xs">{wp.description}</div>}
                <div className="text-muted font-mono text-xs">
                  {formatCoordPair(wp.latitude, wp.longitude, coordinateFormat)}
                </div>
                {onDeleteWaypoint && (
                  <button
                    type="button"
                    onClick={() => onDeleteWaypoint(wp.id)}
                    className={buttonClassName('danger', 'sm', 'mt-1')}
                  >
                    {t('mapPanel.waypointDelete')}
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      {hasTakPanel && showTakContacts ? <TakContactsLayer /> : null}
      {hasEnvironmentTelemetry && showSensors ? (
        <EnvironmentSensorLayer
          nodes={nodesWithPosition}
          protocol={protocol}
          metric={sensorMetric}
          useFahrenheit={useFahrenheit}
          onNodeClick={onNodeClick}
        />
      ) : null}
    </MeshMapShell>
  );
}
