import { MESHCORE_MQTT_FEEDS_STORAGE_KEY } from './meshcoreMqttDefaults';
import { parseStoredJson } from './parseStoredJson';

/**
 * Startup-gate probe that avoids importing the full feed/connect modules into the App chunk.
 * Returns false for a missing/corrupt document.
 */
export function hasEnabledMeshcoreMqttFeed(): boolean {
  const parsed = parseStoredJson<{ feeds?: unknown }>(
    localStorage.getItem(MESHCORE_MQTT_FEEDS_STORAGE_KEY),
    'hasEnabledMeshcoreMqttFeed',
  );
  if (!parsed || !Array.isArray(parsed.feeds)) return false;
  return parsed.feeds.some(
    (feed) =>
      feed !== null && typeof feed === 'object' && (feed as { enabled?: unknown }).enabled === true,
  );
}
