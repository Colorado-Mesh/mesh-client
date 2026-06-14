/**
 * Locale-independent calendar formatting (local wall time).
 * Uses the runtime's default timezone (Electron main + renderer match on the same machine).
 */

function toDate(ts: number | Date): Date {
  return typeof ts === 'number' ? new Date(ts) : ts;
}

/** Local calendar date: YYYY-MM-DD */
export function formatIsoDate(ts: number | Date): string {
  const d = toDate(ts);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/** Local datetime: YYYY-MM-DD HH:mm (24-hour, no seconds) */
export function formatIsoDateTime(ts: number | Date): string {
  const d = toDate(ts);
  const date = formatIsoDate(d);
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${date} ${h}:${mi}`;
}
