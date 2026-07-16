import { rrcRoomMatchKey, rrcRoomsMatch } from './rrcRoomName';

const RECENT_PREFIX = 'mesh-client:rrc:recentRooms:';
const MAX_RECENT = 10;

function canonicalizeRecent(rooms: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rooms) {
    const key = rrcRoomMatchKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

export function loadRrcRecentRooms(hubHash: string): string[] {
  try {
    const storageKey = RECENT_PREFIX + hubHash.toLowerCase();
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const rooms = canonicalizeRecent(parsed.filter((x): x is string => typeof x === 'string'));
    if (raw !== JSON.stringify(rooms)) {
      localStorage.setItem(storageKey, JSON.stringify(rooms));
    }
    return rooms;
  } catch {
    // catch-no-log-ok localStorage may be unavailable
    return [];
  }
}

export function pushRrcRecentRoom(hubHash: string, room: string): string[] {
  const key = rrcRoomMatchKey(room);
  if (!key) return loadRrcRecentRooms(hubHash);
  const prev = loadRrcRecentRooms(hubHash).filter((r) => !rrcRoomsMatch(r, key));
  const next = [key, ...prev].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_PREFIX + hubHash.toLowerCase(), JSON.stringify(next));
  } catch {
    // catch-no-log-ok localStorage may be unavailable
  }
  return next;
}
