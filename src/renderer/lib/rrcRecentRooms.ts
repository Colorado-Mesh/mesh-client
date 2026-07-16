const RECENT_PREFIX = 'mesh-client:rrc:recentRooms:';
const MAX_RECENT = 10;

export const RRC_SUGGESTED_ROOMS = ['#lobby', '#general'] as const;

export function loadRrcRecentRooms(hubHash: string): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PREFIX + hubHash.toLowerCase());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT);
  } catch {
    // catch-no-log-ok localStorage may be unavailable
    return [];
  }
}

export function pushRrcRecentRoom(hubHash: string, room: string): string[] {
  const key = room.trim().toLowerCase();
  if (!key) return loadRrcRecentRooms(hubHash);
  const prev = loadRrcRecentRooms(hubHash).filter((r) => r.toLowerCase() !== key);
  const next = [key, ...prev].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_PREFIX + hubHash.toLowerCase(), JSON.stringify(next));
  } catch {
    // catch-no-log-ok localStorage may be unavailable
  }
  return next;
}
