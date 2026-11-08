import type L from 'leaflet';
import { useEffect, useRef } from 'react';
import { TileLayer, useMap } from 'react-leaflet';

import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import type { RadarFrames } from '@/shared/weather/types';

export function RadarLayer({ frames }: { frames: RadarFrames }): React.JSX.Element | null {
  const map = useMap();
  const frameIndex = useInternetWeatherStore((s) => s.radarFrameIndex);
  const opacity = useInternetWeatherStore((s) => s.radarOpacity);
  const showCoverage = useInternetWeatherStore((s) => s.showCoverage);
  const layerRef = useRef<L.TileLayer | null>(null);
  const frame = frames.frames[frameIndex] ?? frames.frames[frames.frames.length - 1];
  const url = frame?.tileUrlTemplate;

  useEffect(() => {
    if (!url || !layerRef.current) return;
    layerRef.current.setUrl(url, false);
  }, [url]);

  useEffect(() => {
    if (!frames.attribution) return;
    map.attributionControl?.addAttribution(frames.attribution);
    return () => {
      map.attributionControl?.removeAttribution(frames.attribution);
    };
  }, [frames.attribution, map]);

  if (!url) return null;

  return (
    <>
      {showCoverage && frames.coverageUrlTemplate ? (
        <TileLayer
          url={frames.coverageUrlTemplate}
          opacity={0.25}
          maxNativeZoom={frames.maxNativeZoom}
          pane="weather-radar"
          zIndex={1}
          attribution=""
        />
      ) : null}
      <TileLayer
        ref={(ref) => {
          layerRef.current = ref;
        }}
        url={url}
        opacity={opacity}
        maxNativeZoom={frames.maxNativeZoom}
        keepBuffer={3}
        updateWhenIdle
        pane="weather-radar"
        zIndex={2}
        attribution=""
      />
    </>
  );
}
