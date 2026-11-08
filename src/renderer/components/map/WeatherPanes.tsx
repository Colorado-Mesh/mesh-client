import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

import { useInternetWeather } from '@/renderer/hooks/useInternetWeather';

const PANE_SPECS: readonly [string, number][] = [
  ['weather-temp', 350],
  ['weather-radar', 360],
  ['weather-wind', 370],
];

/** Creates Leaflet panes for internet weather overlays and starts viewport fetches. */
export function WeatherPanes(): null {
  const map = useMap();
  useInternetWeather();

  useEffect(() => {
    for (const [name, zIndex] of PANE_SPECS) {
      if (!map.getPane(name)) {
        const pane = map.createPane(name);
        pane.style.zIndex = String(zIndex);
      }
    }
  }, [map]);

  return null;
}
