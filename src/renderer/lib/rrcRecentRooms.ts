import { loadCanonicalStringList, writeStringList } from './localStorageList';
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
  return loadCanonicalStringList(RECENT_PREFIX + hubHash.toLowerCase(), canonicalizeRecent);
}

export function pushRrcRecentRoom(hubHash: string, room: string): string[] {
  const key = rrcRoomMatchKey(room);
  if (!key) return loadRrcRecentRooms(hubHash);
  const prev = loadRrcRecentRooms(hubHash).filter((r) => !rrcRoomsMatch(r, key));
  const next = [key, ...prev].slice(0, MAX_RECENT);
  writeStringList(RECENT_PREFIX + hubHash.toLowerCase(), next);
  return next;
}
