/**
 * Locale-independent calendar formatting (local wall time).
 * Uses the runtime's default timezone (Electron main + renderer match on the same machine).
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDate(ts: number | Date): Date {
  return typeof ts === 'number' ? new Date(ts) : ts;
}

/** Local calendar date: YYYY-MM-DD */
export function formatIsoDate(ts: number | Date): string {
  const d = toDate(ts);
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${mo}-${day}`;
}

/** Local datetime: YYYY-MM-DD HH:mm (24-hour, no seconds) */
export function formatIsoDateTime(ts: number | Date): string {
  const d = toDate(ts);
  const date = formatIsoDate(d);
  const h = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${date} ${h}:${mi}`;
}
