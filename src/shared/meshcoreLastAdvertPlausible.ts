/** Minimum Unix-second `last_advert` we treat as a real epoch timestamp (not repeater uptime). */
export const MESHCORE_LAST_ADVERT_MIN_PLAUSIBLE_SEC = 1_000_000_000;

/** True when `lastAdvertSec` looks like Unix epoch seconds (MeshCore contact freshness). */
export function isPlausibleMeshcoreLastAdvertSec(
  lastAdvertSec: number | null | undefined,
): boolean {
  return (
    typeof lastAdvertSec === 'number' &&
    Number.isFinite(lastAdvertSec) &&
    lastAdvertSec >= MESHCORE_LAST_ADVERT_MIN_PLAUSIBLE_SEC
  );
}
