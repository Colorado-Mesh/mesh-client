/** Locale-neutral `m:ss` countdown until `targetMs` (clamped at 0:00). */
export function formatRetryCountdown(targetMs: number, nowMs: number): string {
  const totalSec = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
