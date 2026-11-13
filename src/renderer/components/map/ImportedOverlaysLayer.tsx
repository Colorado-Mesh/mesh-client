import L, { type PathOptions } from 'leaflet';
import { GeoJSON as LeafletGeoJson } from 'react-leaflet';

import { type MapOverlayLayer, useMapOverlayStore } from '@/renderer/stores/mapOverlayStore';

function styleForLayer(layer: MapOverlayLayer): PathOptions {
  const opacity = layer.opacity;
  return {
    color: '#38bdf8',
    weight: 2,
    opacity,
    fillColor: '#38bdf8',
    fillOpacity: Math.max(0, opacity * 0.35),
  };
}

/** Renders imported local vector overlays inside MeshMapShell (LoRa + Reticulum). */
export function ImportedOverlaysLayer() {
  const layers = useMapOverlayStore((s) => s.layers);
  if (layers.length === 0) return null;
  return (
    <>
      {layers
        .filter((layer) => layer.visible)
        .map((layer) => (
          <LeafletGeoJson
            key={`${layer.id}:${layer.opacity}`}
            data={layer.geojson as GeoJSON.GeoJsonObject}
            style={() => styleForLayer(layer)}
            pointToLayer={(_feature, latlng) =>
              L.circleMarker(latlng, {
                radius: 5,
                color: '#38bdf8',
                weight: 2,
                opacity: layer.opacity,
                fillColor: '#38bdf8',
                fillOpacity: Math.max(0, layer.opacity * 0.55),
              })
            }
          />
        ))}
    </>
  );
}
