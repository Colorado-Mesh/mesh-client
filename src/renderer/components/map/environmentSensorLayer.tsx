import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, Tooltip } from 'react-leaflet';

import { useNowMs } from '@/renderer/hooks/useNowMs';
import {
  formatSensorMetric,
  MAP_SENSOR_METRICS,
  type MapSensorMetric,
  SENSOR_LAYER_MAX_AGE_MS,
  sensorColorForValue,
} from '@/renderer/lib/environmentSensorDisplay';
import { nodeDisplayName } from '@/renderer/lib/nodeLongNameOrHex';
import type { MeshNode } from '@/renderer/lib/types';
import {
  type EnvironmentHistoryPoint,
  latestEnvironmentReading,
  latestEnvironmentValue,
  selectEnvironmentSeries,
  useEnvironmentTelemetryStore,
} from '@/renderer/stores/environmentTelemetryStore';
import type { EnvironmentReading } from '@/shared/environmentTelemetry';
import type { MeshProtocol } from '@/shared/meshProtocol';

export interface SensorMarker {
  nodeId: number;
  name: string;
  lat: number;
  lon: number;
  value: number;
  reading: EnvironmentReading;
}

/**
 * Positioned nodes with a recent reading for `metric`. `nodes` must already carry the map's
 * resolved display position (MapPanel `nodesWithPosition`), so map filters apply here too.
 */
function sensorMarkerForNode(
  node: MeshNode,
  points: readonly EnvironmentHistoryPoint[] | undefined,
  metric: MapSensorMetric,
  protocol: MeshProtocol,
  now: number,
): SensorMarker | null {
  if (node.latitude == null || node.longitude == null || !points) return null;
  const latest = latestEnvironmentValue(points, metric);
  if (!latest || now - latest.t > SENSOR_LAYER_MAX_AGE_MS) return null;
  return {
    nodeId: node.node_id,
    name: nodeDisplayName(node, protocol),
    lat: node.latitude,
    lon: node.longitude,
    value: latest.value,
    reading: latestEnvironmentReading(points),
  };
}

export function sensorMarkersFor(
  nodes: readonly MeshNode[],
  series: ReadonlyMap<number, readonly EnvironmentHistoryPoint[]>,
  metric: MapSensorMetric,
  protocol: MeshProtocol,
  now: number,
): SensorMarker[] {
  const out: SensorMarker[] = [];
  for (const node of nodes) {
    const marker = sensorMarkerForNode(node, series.get(node.node_id), metric, protocol, now);
    if (marker) out.push(marker);
  }
  return out;
}

interface Props {
  nodes: readonly MeshNode[];
  protocol: MeshProtocol;
  metric: MapSensorMetric;
  useFahrenheit: boolean;
  onNodeClick?: (nodeId: number) => void;
}

interface MarkerProps {
  node: MeshNode;
  protocol: MeshProtocol;
  metric: MapSensorMetric;
  useFahrenheit: boolean;
  nowMs: number;
  onNodeClick?: (nodeId: number) => void;
}

/**
 * One positioned node. Subscribes to that node's series so a new sample re-renders this marker
 * only. The selected metric is already listed in the tooltip, so there is no second marker.
 */
const EnvironmentSensorMarker = memo(function EnvironmentSensorMarker({
  node,
  protocol,
  metric,
  useFahrenheit,
  nowMs,
  onNodeClick,
}: MarkerProps) {
  const { t } = useTranslation();
  const series = useEnvironmentTelemetryStore((s) =>
    selectEnvironmentSeries(s, protocol, node.node_id),
  );
  const marker = sensorMarkerForNode(node, series, metric, protocol, nowMs);
  if (!marker) return null;
  const color = sensorColorForValue(metric, marker.value);
  return (
    <CircleMarker
      center={[marker.lat, marker.lon]}
      radius={9}
      pathOptions={{ color, fillColor: color, fillOpacity: 0.55, weight: 2 }}
      eventHandlers={
        onNodeClick
          ? {
              click: () => {
                onNodeClick(marker.nodeId);
              },
            }
          : undefined
      }
    >
      <Tooltip direction="top">
        <div className="font-medium">{marker.name}</div>
        {MAP_SENSOR_METRICS.map((k) => {
          const v = marker.reading[k];
          if (v === undefined) return null;
          return (
            <div key={k} data-testid={k === metric ? `sensor-label-${marker.nodeId}` : undefined}>
              {formatSensorMetric(t, k, v, useFahrenheit)}
            </div>
          );
        })}
      </Tooltip>
    </CircleMarker>
  );
});

/** Latest temperature / humidity / pressure per positioned node, colored by value band. */
export function EnvironmentSensorLayer({
  nodes,
  protocol,
  metric,
  useFahrenheit,
  onNodeClick,
}: Props) {
  const nowMs = useNowMs();
  return (
    <>
      {nodes.map((node) => (
        <EnvironmentSensorMarker
          key={node.node_id}
          node={node}
          protocol={protocol}
          metric={metric}
          useFahrenheit={useFahrenheit}
          nowMs={nowMs}
          onNodeClick={onNodeClick}
        />
      ))}
    </>
  );
}
