import { useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';

import { MS_PER_MINUTE } from '@/shared/timeConstants';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import { useInternetWeatherStore } from '../stores/internetWeatherStore';
import { useMapLayerStore } from '../stores/mapLayerStore';

const DEBOUNCE_MS = 350;
const GRID_POLL_MS = 10 * MS_PER_MINUTE;
const RADAR_POLL_MS = 5 * MS_PER_MINUTE;

/**
 * Fetches internet weather grid/radar for the visible map viewport when overlays are enabled.
 * Mount once inside MeshMapShell's MapContainer.
 */
export function useInternetWeather(): void {
  const map = useMap();
  const enabled = useInternetWeatherStore((s) => s.enabled);
  const radarProvider = useInternetWeatherStore((s) => s.radarProvider);
  const showRadar = useMapLayerStore((s) => s.showRadar);
  const showTemp = useMapLayerStore((s) => s.showWeatherTemperature);
  const showWind = useMapLayerStore((s) => s.showWeatherWind);
  const generationRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => {
    if (!enabled) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      useInternetWeatherStore.getState().setError({ code: 'offline', message: 'offline' });
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!showRadar && !showTemp && !showWind) return;

    const gen = ++generationRef.current;
    const b = map.getBounds();
    const bounds = {
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    };
    const zoom = map.getZoom();
    const api = window.electronAPI?.weather;
    if (!api) return;

    void (async () => {
      try {
        if (showTemp || showWind) {
          useInternetWeatherStore.getState().setGridStatus('loading');
          const res = await api.grid({ bounds, zoom });
          if (gen !== generationRef.current) return;
          if (res.ok) {
            useInternetWeatherStore.getState().setGrid(res.data);
            useInternetWeatherStore.getState().setGridStatus('ready');
            useInternetWeatherStore.getState().setLastUpdatedMs(res.data.fetchedAtMs);
            useInternetWeatherStore.getState().setError(null);
          } else {
            useInternetWeatherStore.getState().setGridStatus('error');
            useInternetWeatherStore.getState().setError(res.error);
          }
        }

        if (showRadar) {
          useInternetWeatherStore.getState().setRadarStatus('loading');
          const res = await api.radarFrames({ bounds, zoom, provider: radarProvider });
          if (gen !== generationRef.current) return;
          if (res.ok) {
            const prev = useInternetWeatherStore.getState().radarFrames;
            useInternetWeatherStore.getState().setRadarFrames(res.data);
            if (!prev || prev.frames.length === 0) {
              useInternetWeatherStore
                .getState()
                .setRadarFrameIndex(Math.max(0, res.data.frames.length - 1));
            }
            useInternetWeatherStore.getState().setRadarStatus('ready');
            useInternetWeatherStore.getState().setLastUpdatedMs(res.data.fetchedAtMs);
            useInternetWeatherStore.getState().setError(null);
          } else {
            useInternetWeatherStore.getState().setRadarStatus('error');
            useInternetWeatherStore.getState().setError(res.error);
          }
        }
      } catch (e) {
        if (gen !== generationRef.current) return;
        console.warn('[useInternetWeather] refresh failed ' + errLikeToLogString(e));
        useInternetWeatherStore.getState().setError({
          code: 'provider_error',
          message: 'provider_error',
        });
      }
    })();
  };

  const schedule = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      refresh();
    }, DEBOUNCE_MS);
  };

  useMapEvents({
    moveend: schedule,
    zoomend: schedule,
  });

  useEffect(() => {
    schedule();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when toggles/provider change
  }, [enabled, showRadar, showTemp, showWind, radarProvider]);

  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    const onOnline = () => {
      useInternetWeatherStore.getState().setError(null);
      schedule();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const needGrid = showTemp || showWind;
    const timers: number[] = [];
    if (needGrid) {
      timers.push(
        window.setInterval(() => {
          if (document.visibilityState === 'visible') refresh();
        }, GRID_POLL_MS),
      );
    }
    if (showRadar) {
      timers.push(
        window.setInterval(() => {
          if (document.visibilityState === 'visible') refresh();
        }, RADAR_POLL_MS),
      );
    }
    return () => {
      for (const id of timers) window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, showRadar, showTemp, showWind, radarProvider]);
}
