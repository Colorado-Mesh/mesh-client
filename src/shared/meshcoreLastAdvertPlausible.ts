/** Minimum Unix-second `last_advert` we treat as a real epoch timestamp (not repeater uptime). */
export const MESHCORE_LAST_ADVERT_MIN_PLAUSIBLE_SEC = 1_000_000_000;

/** Max device clock lead we accept before clamping `last_advert` to receive-time estimate. */
export const MESHCORE_LAST_ADVERT_MAX_FUTURE_SKEW_SEC = 300;

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

/** Clamp unreasonably future `last_advert` (repeater RTC skew) to `nowSec`. */
export function clampMeshcoreLastAdvertSec(
  lastAdvertSec: number,
  nowSec = Math.floor(Date.now() / 1000),
  maxFutureSkewSec = MESHCORE_LAST_ADVERT_MAX_FUTURE_SKEW_SEC,
): number {
  if (!lastAdvertSec || !Number.isFinite(lastAdvertSec)) return 0;
  const floored = Math.floor(lastAdvertSec);
  if (floored <= nowSec + maxFutureSkewSec) return floored;
  return nowSec;
}
