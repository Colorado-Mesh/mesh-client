import { useEffect, useMemo } from 'react';

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
  const ensureLoaded = useCustomMapSourcesStore((s) => s.ensureLoaded);
  const isCustom = isCustomMapSourceId(basemapId);
  useEffect(() => {
    if (isCustom) void ensureLoaded();
  }, [isCustom, ensureLoaded]);
  return useMemo(() => resolveMapBasemap(basemapId, customSources), [basemapId, customSources]);
}
