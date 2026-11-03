import { useEffect, useMemo, useRef } from 'react';

import {
  type MapBasemapConfig,
  type MapBasemapId,
  resolveMapBasemap,
} from '@/renderer/lib/mapBasemapUtils';
import { useCustomMapSourcesStore } from '@/renderer/stores/customMapSourcesStore';
import { isCustomMapSourceId } from '@/shared/offlineMaps/customMapSources';

/** Resolve the Leaflet config for a basemap id, loading custom sources on demand. */
export function useMapBasemap(basemapId: MapBasemapId): MapBasemapConfig {
  const customSources = useCustomMapSourcesStore((s) => s.sources);
  const loadError = useCustomMapSourcesStore((s) => s.loadError);
  const ensureLoaded = useCustomMapSourcesStore((s) => s.ensureLoaded);
  const retriedAfterError = useRef(false);
  const isCustom = isCustomMapSourceId(basemapId);
  useEffect(() => {
    if (!isCustom || customSources !== null) return;
    if (loadError && retriedAfterError.current) return;
    if (loadError) retriedAfterError.current = true;
    void ensureLoaded();
  }, [customSources, ensureLoaded, isCustom, loadError]);
  return useMemo(() => resolveMapBasemap(basemapId, customSources), [basemapId, customSources]);
}
