import { parseStoredJson } from '../parseStoredJson';

const MAX_TRANSPORT_DISPLAY_NAME_CACHE_ENTRIES = 64;

/** Store the most-recent short name for a BLE peripheral or serial port. */
export function cacheTransportDisplayName(
  storageKey: string,
  cacheKey: string,
  shortName: string,
): void {
  try {
    const cache =
      parseStoredJson<Record<string, string>>(
        localStorage.getItem(storageKey),
        `transportDisplayNameCache ${storageKey}`,
      ) ?? {};
    const entries = Object.entries(cache).filter(([key]) => key !== cacheKey);
    entries.push([cacheKey, shortName]);
    localStorage.setItem(
      storageKey,
      JSON.stringify(Object.fromEntries(entries.slice(-MAX_TRANSPORT_DISPLAY_NAME_CACHE_ENTRIES))),
    );
  } catch {
    // catch-no-log-ok localStorage display-name cache is non-critical
  }
}
