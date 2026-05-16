import { normalizeLastHeardMs } from './nodeStatus';

/** Short English relative time for compact UI (e.g. chat DM header). */
export function formatShortRelativeAgo(nowMs: number, lastHeard: number): string | null {
  if (!lastHeard || !nowMs) return null;
  const lastHeardMs = normalizeLastHeardMs(lastHeard);
  if (!lastHeardMs) return null;
  const diff = nowMs - lastHeardMs;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
