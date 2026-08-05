import { loadCanonicalStringList, writeStringList } from './localStorageList';
import { rrcRoomMatchKey, rrcRoomsMatch } from './rrcRoomName';

const RECENT_PREFIX = 'mesh-client:rrc:recentRooms:';
const MAX_RECENT = 10;

/** Hub JOIN recent list — never synthetic streams (`[hub]`, `[whispers]`) or `@hash` DMs. */
function isJoinableRecentRoom(key: string): boolean {
  return Boolean(key) && !key.startsWith('[') && !key.startsWith('@');
}

function canonicalizeRecent(rooms: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rooms) {
    const key = rrcRoomMatchKey(raw);
    if (!isJoinableRecentRoom(key) || seen.has(key)) continue;
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
  if (!isJoinableRecentRoom(key)) return loadRrcRecentRooms(hubHash);
  const prev = loadRrcRecentRooms(hubHash).filter((r) => !rrcRoomsMatch(r, key));
  const next = [key, ...prev].slice(0, MAX_RECENT);
  writeStringList(RECENT_PREFIX + hubHash.toLowerCase(), next);
  return next;
}
