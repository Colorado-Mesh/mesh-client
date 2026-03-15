import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

import type { LocationFilter } from '../App';
import { getRoutingRowForNode, routingAnomalyNodeIds } from '../lib/diagnostics/diagnosticRows';
import type { OurPosition } from '../lib/gpsSource';
import { getNodeStatus, haversineDistanceKm } from '../lib/nodeStatus';
import type { MeshNode, MeshWaypoint, NodeAnomaly } from '../lib/types';
import { routingRowToNodeAnomaly } from '../lib/types';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { useMapViewportStore } from '../stores/mapViewportStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import NodeInfoBody from './NodeInfoBody';
import { useToast } from './Toast';

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
    .leaflet-popup-content-wrapper {
      background: #0d0d0d;
      border: 1px solid #374151;
      color: #e5e7eb;
      border-radius: 0.75rem;
      padding: 0;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    }
    .leaflet-popup-tip {
      background: #0d0d0d;
    }
    .leaflet-popup-content {
      margin: 0;
      min-width: 220px;
      max-width: 320px;
    }
    .leaflet-popup-close-button {
      color: #9ca3af !important;
    }
    .leaflet-popup-close-button:hover {
      color: #e5e7eb !important;
    }
    .leaflet-locate-control a {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      background: #fff;
      color: #444;
      cursor: pointer;
      border: none;
      outline: none;
    }
    .leaflet-locate-control a:hover {
      background: #f4f4f4;
      color: #000;
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

function createMarkerIcon(
  color: string,
  isSelf: boolean,
  cu = 0,
  markerOpacity = 1,
  isMqttOnly = false,
): L.Icon {
  const haloPx = cu <= 0 ? 0 : Math.round((cu / 100) * 14);
  const haloColor = getCUColor(cu);
  const halo = (c: number) =>
    haloPx > 0
      ? `<circle cx="${c}" cy="${c}" r="${c - 0.5}" fill="${haloColor}" opacity="0.4"/>`
      : '';
  const mqttBadge = (c: number) =>
    isMqttOnly
      ? `<circle cx="${c + 7}" cy="${c - 7}" r="4" fill="#3b82f6" stroke="#fff" stroke-width="1.5"/>`
      : '';

  if (isSelf) {
    const total = 32 + 2 * haloPx;
    const c = total / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" opacity="${markerOpacity}">${halo(c)}<g transform="translate(${haloPx},${haloPx}) scale(${32 / 24})"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${color}" stroke="#000" stroke-width="0.5"/></g>${mqttBadge(c)}</svg>`;
    return L.icon({
      iconUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      iconSize: [total, total],
      iconAnchor: [c, c],
      popupAnchor: [0, -c],
    });
  }

  const total = 25 + 2 * haloPx;
  const c = total / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" opacity="${markerOpacity}">${halo(c)}<circle cx="${c}" cy="${c}" r="10.4" fill="${color}" stroke="#000" stroke-width="1" opacity="0.9"/><circle cx="${c}" cy="${c}" r="4.2" fill="#fff" opacity="0.8"/>${mqttBadge(c)}</svg>`;
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
): L.Icon {
  const color = status === 'online' ? '#9ae6b4' : status === 'stale' ? '#c4a864' : '#6b7280';
  const opacity = status === 'online' ? 1 : status === 'stale' ? 0.65 : 0.45;
  return createMarkerIcon(color, isSelf, cu, opacity, isMqttOnly);
}

const PATH_COLORS = {
  online: '#9ae6b4',
  stale: '#c4a864',
  offline: '#6b7280',
} as const;

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
  isSelf: boolean;
  anomalyHalosEnabled: boolean;
  congestionHalosEnabled: boolean;
  homeNode?: MeshNode | null;
  haloCenterOffset?: [number, number];
  nodes: Map<number, MeshNode>;
}

const MapMarker = memo(
  function MapMarker({
    node,
    anomaly,
    isSelf,
    anomalyHalosEnabled,
    congestionHalosEnabled,
    homeNode,
    haloCenterOffset = [0, 0],
    nodes,
  }: MapMarkerProps) {
    const status = getNodeStatus(node.last_heard);
    const cuForIcon = congestionHalosEnabled ? (node.channel_utilization ?? 0) : 0;

    const icon = useMemo(
      () => getMarkerIcon(status, isSelf, cuForIcon, node.heard_via_mqtt_only),
      [status, isSelf, cuForIcon, node.heard_via_mqtt_only],
    );

    const shouldShowHalo = useMemo(
      () => anomalyHalosEnabled && anomaly !== null && anomaly.nodeId === node.node_id && !isSelf,
      [anomalyHalosEnabled, anomaly, node.node_id, isSelf],
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
              color: isError ? '#ef4444' : '#FFBF00',
              fillColor: isError ? '#ef4444' : '#FFBF00',
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
        <Marker
          position={[node.latitude!, node.longitude!]}
          icon={icon}
          zIndexOffset={isSelf ? 1000 : 0}
        >
          <Popup>
            <div className="px-4 py-3">
              <div className="font-semibold text-gray-100 mb-2 flex items-center gap-1.5">
                {isSelf && <span title="Your node">★</span>}
                {node.long_name || `!${node.node_id.toString(16)}`}
                {(() => {
                  const shortId = `!${node.node_id.toString(16)}`;
                  const displayName = node.long_name || shortId;
                  if (shortId === displayName.trim()) return null;
                  return (
                    <span className="text-xs text-muted font-mono ml-1">
                      !{node.node_id.toString(16)}
                    </span>
                  );
                })()}
              </div>
              <NodeInfoBody node={node} homeNode={homeNode} nodes={nodes} />
            </div>
          </Popup>
        </Marker>
      </Fragment>
    );
  },
  (prev, next) =>
    prev.node === next.node &&
    prev.isSelf === next.isSelf &&
    prev.anomalyHalosEnabled === next.anomalyHalosEnabled &&
    prev.congestionHalosEnabled === next.congestionHalosEnabled &&
    prev.homeNode === next.homeNode &&
    prev.nodes === next.nodes &&
    prev.anomaly?.type === next.anomaly?.type &&
    prev.anomaly?.severity === next.anomaly?.severity &&
    prev.haloCenterOffset?.[0] === next.haloCenterOffset?.[0] &&
    prev.haloCenterOffset?.[1] === next.haloCenterOffset?.[1],
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
      const center: [number, number] = ourPosition
        ? [ourPosition.lat, ourPosition.lon]
        : DEFAULT_CENTER;
      map.setView(center, DEFAULT_ZOOM);
    }
  }, [positions.length, ourPosition, map, shouldFitOnMount]);
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
        current &&
        current.zoom === next.zoom &&
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
          addToast('Location unavailable.', 'error');
        }
        return;
      }
      const result = await (window as any).electronAPI.getGpsFix();
      if (result.status === 'error') {
        addToast(result.message, 'error');
        return;
      }
      if ('error' in result) {
        addToast(
          result.code === 'NO_FIX'
            ? 'GPS hardware not available.'
            : `Location error: ${result.error}`,
          'error',
        );
        return;
      }
      const coords: [number, number] = [result.lat, result.lon];
      setLocatedPos(coords);
      map.flyTo(coords, 16);
    } catch (e) {
      console.error('[LocateMeControl] getGpsFix failed:', e);
      addToast('Location request failed.', 'error');
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
          <a
            title="Show my location"
            aria-label="Show my location"
            aria-busy={loading}
            role="button"
            className={loading ? 'locating' : ''}
            onClick={handleLocate}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="8" />
              <line x1="12" y1="2" x2="12" y2="6" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="2" y1="12" x2="6" y2="12" />
              <line x1="18" y1="12" x2="22" y2="12" />
            </svg>
          </a>
        </div>
      </div>
      {locatedPos && (
        <CircleMarker
          center={locatedPos}
          radius={8}
          pathOptions={{ color: '#fff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }}
        />
      )}
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
}

export default function MapPanel({
  nodes,
  myNodeNum,
  locationFilter,
  ourPosition,
  onLocateMe,
  waypoints,
  onDeleteWaypoint,
}: Props) {
  const homeNode = nodes.get(myNodeNum) ?? null;

  const congestionHalosEnabled = useDiagnosticsStore((s) => s.congestionHalosEnabled);
  const anomalyHalosEnabled = useDiagnosticsStore((s) => s.anomalyHalosEnabled);
  const diagnosticRows = useDiagnosticsStore((s) => s.diagnosticRows);
  const routingNodeIds = useMemo(() => routingAnomalyNodeIds(diagnosticRows), [diagnosticRows]);

  const positionHistory = usePositionHistoryStore((s) => s.history);
  const showPaths = usePositionHistoryStore((s) => s.showPaths);

  useEffect(() => {
    ensureMapStyles();
  }, []);

  const nodesWithPosition = useMemo(() => {
    const homeNode = myNodeNum ? nodes.get(myNodeNum) : undefined;
    const homeHasLocation =
      homeNode &&
      homeNode.latitude != null &&
      homeNode.latitude !== 0 &&
      homeNode.longitude != null &&
      homeNode.longitude !== 0;
    const maxKm =
      locationFilter.unit === 'miles'
        ? locationFilter.maxDistance * 1.60934
        : locationFilter.maxDistance;

    return Array.from(nodes.values()).filter((n) => {
      if (
        n.latitude == null ||
        n.longitude == null ||
        !(Math.abs(n.latitude) > 0.0001 || Math.abs(n.longitude) > 0.0001)
      )
        return false;
      if (locationFilter.hideMqttOnly && n.heard_via_mqtt_only) return false;
      if (locationFilter.enabled && homeHasLocation) {
        const d = haversineDistanceKm(
          homeNode!.latitude!,
          homeNode!.longitude!,
          n.latitude!,
          n.longitude!,
        );
        if (d > maxKm) return false;
      }
      return true;
    });
  }, [nodes, myNodeNum, locationFilter]);

  const nodesToRender = useMemo(() => {
    const idSet = new Set(nodesWithPosition.map((n) => n.node_id));
    const out: MeshNode[] = [...nodesWithPosition];
    for (const nodeId of routingNodeIds) {
      if (idSet.has(nodeId)) continue;
      const node = nodes.get(nodeId);
      if (
        !node ||
        node.latitude == null ||
        node.longitude == null ||
        !(Math.abs(node.latitude) > 0.0001 || Math.abs(node.longitude) > 0.0001)
      )
        continue;
      idSet.add(nodeId);
      out.push(node);
    }
    const byPos = new Map<string, MeshNode>();
    for (const n of out) {
      const k = `${n.latitude},${n.longitude}`;
      const existing = byPos.get(k);
      const hasAnomaly = routingNodeIds.has(n.node_id);
      const existingHasAnomaly = existing ? routingNodeIds.has(existing.node_id) : false;
      if (!existing || (hasAnomaly && !existingHasAnomaly)) byPos.set(k, n);
    }
    return Array.from(byPos.values());
  }, [nodesWithPosition, routingNodeIds, nodes]);

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

  const positions = useMemo<[number, number][]>(
    () => nodesToRender.map((n) => [n.latitude!, n.longitude!]),
    [nodesToRender],
  );

  const movingNodePaths = useMemo(() => {
    if (!showPaths) return [];
    const result: { nodeId: number; positions: [number, number][]; color: string }[] = [];
    for (const [nodeId, points] of positionHistory) {
      if (points.length < 2) continue;
      const node = nodes.get(nodeId);
      if (!node) continue;
      const status = getNodeStatus(node.last_heard);
      result.push({
        nodeId,
        positions: points.map((p) => [p.lat, p.lon]),
        color: PATH_COLORS[status],
      });
    }
    return result;
  }, [positionHistory, showPaths, nodes]);

  const savedViewport = useMapViewportStore((s) => s.viewport);
  const computedCenter: [number, number] =
    nodesToRender.length > 0
      ? [nodesToRender[0].latitude!, nodesToRender[0].longitude!]
      : ourPosition
        ? [ourPosition.lat, ourPosition.lon]
        : DEFAULT_CENTER;
  const computedZoom = DEFAULT_ZOOM;
  const shouldFitOnMount = savedViewport == null;
  // Use current viewport from store when available so props match the map after
  // moveend; otherwise react-leaflet syncs map to (stale) props → setView →
  // moveend → setViewport → re-render loop.
  const mapCenter = savedViewport?.center ?? computedCenter;
  const mapZoom = savedViewport?.zoom ?? computedZoom;

  const statusCounts = useMemo(() => {
    const counts = { online: 0, stale: 0, offline: 0 };
    for (const n of nodesToRender) {
      counts[getNodeStatus(n.last_heard)]++;
    }
    return counts;
  }, [nodesToRender]);

  return (
    <div
      className="h-full min-h-[500px] rounded-lg overflow-hidden border border-gray-700 relative"
      aria-label="Network map showing node positions"
    >
      {/* Controls overlay — top right */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2">
        <div className="bg-deep-black/80 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-3 text-xs border border-gray-700">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-brand-green inline-block" />
            {statusCounts.online}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block opacity-60" />
            {statusCounts.stale}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />
            {statusCounts.offline}
          </span>
        </div>
      </div>

      <MapContainer center={mapCenter} zoom={mapZoom} className="h-full w-full">
        <DiagnosticPanes />
        <ViewportSaver hasAnyPositions={positions.length > 0 || !!ourPosition} />
        <MapFitter
          positions={positions}
          ourPosition={ourPosition}
          shouldFitOnMount={shouldFitOnMount}
        />
        <LocateMeControl onLocateMe={onLocateMe} />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {movingNodePaths.map(({ nodeId, positions: pathPositions, color }) => (
          <Polyline
            key={`path-${nodeId}`}
            positions={pathPositions}
            pathOptions={{ color, weight: 3, opacity: 0.65 }}
          />
        ))}
        {nodesWithStatusAndHaloOffset.map(({ node, anomaly, haloCenterOffset }) => (
          <MapMarker
            key={node.node_id}
            node={node}
            anomaly={anomaly}
            isSelf={node.node_id === myNodeNum}
            anomalyHalosEnabled={anomalyHalosEnabled}
            congestionHalosEnabled={congestionHalosEnabled}
            homeNode={homeNode}
            haloCenterOffset={haloCenterOffset}
            nodes={nodes}
          />
        ))}
        {waypoints &&
          [...waypoints.values()].map((wp) => (
            <Marker
              key={wp.id}
              position={[wp.latitude, wp.longitude]}
              icon={L.divIcon({
                className: '',
                html: `<div style="background:#f59e0b;border:2px solid #fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;">📍</div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9],
              })}
            >
              <Popup>
                <div className="p-2 space-y-1">
                  <div className="font-medium text-gray-100 text-sm">{wp.name || 'Waypoint'}</div>
                  {wp.description && <div className="text-xs text-gray-400">{wp.description}</div>}
                  <div className="text-xs text-gray-500 font-mono">
                    {wp.latitude.toFixed(5)}, {wp.longitude.toFixed(5)}
                  </div>
                  {onDeleteWaypoint && (
                    <button
                      onClick={() => onDeleteWaypoint(wp.id)}
                      className="mt-1 w-full px-2 py-1 text-xs bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded border border-red-800/50 transition-colors"
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
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-deep-black/80 px-4 py-2 rounded-lg text-muted text-sm">
            No nodes with GPS positions yet
          </div>
        </div>
      )}
    </div>
  );
}
