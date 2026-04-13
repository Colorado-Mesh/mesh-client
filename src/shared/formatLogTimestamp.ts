/**
 * Local-time log timestamps (compact; no trailing Z or offset on file lines).
 * Uses the runtime's default timezone (Electron main + renderer match on the same machine).
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** Full line prefix for on-disk logs: YYYY-MM-DDTHH:mm:ss.mmm (local wall time). */
export function formatLogFileTimestamp(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  const ms = pad3(d.getMilliseconds());
  return `${y}-${mo}-${day}T${h}:${mi}:${s}.${ms}`;
}

/** Compact time column for log panels: HH:MM:SS.mmm (local wall time). */
export function formatLogTimeOfDay(ts: number): string {
  const d = new Date(ts);
  const h = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  const ms = pad3(d.getMilliseconds());
  return `${h}:${mi}:${s}.${ms}`;
}
