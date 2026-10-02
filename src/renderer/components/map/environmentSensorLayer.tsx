import { useMemo } from 'react';
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
  latestEnvironmentReading,
  latestEnvironmentValue,
  selectEnvironmentNodes,
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
export function sensorMarkersFor(
  nodes: readonly MeshNode[],
  series: ReturnType<typeof selectEnvironmentNodes>,
  metric: MapSensorMetric,
  protocol: MeshProtocol,
  now: number,
): SensorMarker[] {
  const out: SensorMarker[] = [];
  for (const node of nodes) {
    if (node.latitude == null || node.longitude == null) continue;
    const points = series.get(node.node_id);
    if (!points) continue;
    const latest = latestEnvironmentValue(points, metric);
    if (!latest || now - latest.t > SENSOR_LAYER_MAX_AGE_MS) continue;
    out.push({
      nodeId: node.node_id,
      name: nodeDisplayName(node, protocol),
      lat: node.latitude,
      lon: node.longitude,
      value: latest.value,
      reading: latestEnvironmentReading(points),
    });
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

/** Latest temperature / humidity / pressure per positioned node, colored by value band. */
export function EnvironmentSensorLayer({
  nodes,
  protocol,
  metric,
  useFahrenheit,
  onNodeClick,
}: Props) {
  const { t } = useTranslation();
  const series = useEnvironmentTelemetryStore((s) => selectEnvironmentNodes(s, protocol));
  const nowMs = useNowMs();
  const markers = useMemo(
    () => sensorMarkersFor(nodes, series, metric, protocol, nowMs),
    [nodes, series, metric, protocol, nowMs],
  );
  if (markers.length === 0) return null;
  return (
    <>
      {markers.map((m) => {
        const color = sensorColorForValue(metric, m.value);
        return (
          <CircleMarker
            key={`sensor-${m.nodeId}`}
            center={[m.lat, m.lon]}
            radius={9}
            pathOptions={{ color, fillColor: color, fillOpacity: 0.55, weight: 2 }}
            eventHandlers={
              onNodeClick
                ? {
                    click: () => {
                      onNodeClick(m.nodeId);
                    },
                  }
                : undefined
            }
          >
            <Tooltip direction="top">
              <div className="font-medium">{m.name}</div>
              {MAP_SENSOR_METRICS.map((k) => {
                const v = m.reading[k];
                return v === undefined ? null : (
                  <div key={k}>{formatSensorMetric(t, k, v, useFahrenheit)}</div>
                );
              })}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {markers.map((m) => (
        <CircleMarker
          key={`sensor-label-${m.nodeId}`}
          center={[m.lat, m.lon]}
          radius={0}
          interactive={false}
          pathOptions={{ opacity: 0, fillOpacity: 0 }}
        >
          <Tooltip permanent direction="right" offset={[10, 0]}>
            <span data-testid={`sensor-label-${m.nodeId}`}>
              {formatSensorMetric(t, metric, m.value, useFahrenheit)}
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}
