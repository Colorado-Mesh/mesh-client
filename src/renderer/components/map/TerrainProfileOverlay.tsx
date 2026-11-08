import { useEffect, useRef, useState } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useMapToolStore } from '@/renderer/stores/mapToolStore';
import type { ElevationProfileResult } from '@/shared/elevation/types';

import { TerrainProfileChart } from './TerrainProfileChart';

/** Bottom-right chart overlay outside Leaflet; samples elevation when two endpoints exist. */
export function TerrainProfileOverlay(): React.JSX.Element | null {
  const profileActive = useMapToolStore((s) => s.profileActive);
  const endpoints = useMapToolStore((s) => s.profileEndpoints);
  const frequencyMhz = useMapToolStore((s) => s.profileFrequencyMhz);

  const [result, setResult] = useState<ElevationProfileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const canSample = profileActive && endpoints.length >= 2;

  useEffect(() => {
    if (!canSample) return;
    const [a, b] = endpoints;
    if (!a || !b) return;
    const requestId = ++requestIdRef.current;
    void (async () => {
      // Yield so setState is not synchronous in the effect body (react-hooks/set-state-in-effect).
      await Promise.resolve();
      if (requestId !== requestIdRef.current) return;
      setLoading(true);
      setErrorKey(null);
      const api = window.electronAPI?.elevation;
      if (!api) {
        setLoading(false);
        setErrorKey('mapPanel.terrainProfile.errorUnavailable');
        return;
      }
      try {
        const res = await api.sampleProfile({
          start: { lat: a.lat, lon: a.lon },
          end: { lat: b.lat, lon: b.lon },
          antennaHeightStartM: a.antennaHeightM ?? 2,
          antennaHeightEndM: b.antennaHeightM ?? 2,
          frequencyMhz,
          sampleCount: 64,
        });
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        if (res.ok) {
          setResult(res.data);
          setErrorKey(null);
        } else {
          setResult(null);
          setErrorKey(
            res.error.code === 'offline'
              ? 'mapPanel.terrainProfile.errorOffline'
              : 'mapPanel.terrainProfile.errorFetch',
          );
        }
      } catch (err: unknown) {
        console.warn('[TerrainProfile] ' + errLikeToLogString(err));
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        setResult(null);
        setErrorKey('mapPanel.terrainProfile.errorFetch');
      }
    })();
  }, [canSample, endpoints, frequencyMhz]);

  if (!profileActive) return null;

  return (
    <div className="pointer-events-auto absolute right-3 bottom-8 z-[500]">
      <TerrainProfileChart
        result={canSample ? result : null}
        loading={canSample ? loading : false}
        errorKey={canSample ? errorKey : null}
      />
    </div>
  );
}
