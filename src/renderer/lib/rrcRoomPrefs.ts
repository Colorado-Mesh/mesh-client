import { rrcRoomMatchKey } from './rrcRoomName';

const FAV_PREFIX = 'mesh-client:rrc:roomFavourites:';
const AUTO_PREFIX = 'mesh-client:rrc:autoJoin:';

function readRawStringList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // catch-no-log-ok localStorage may be unavailable
    return [];
  }
}

function writeStringList(key: string, rooms: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(rooms));
  } catch {
    // catch-no-log-ok localStorage may be unavailable
  }
}

function canonicalizeRoomList(rooms: string[]): string[] {
  return [...new Set(rooms.map((r) => rrcRoomMatchKey(r)).filter(Boolean))];
}

function loadCanonicalList(storageKey: string): string[] {
  const rooms = canonicalizeRoomList(readRawStringList(storageKey));
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw !== JSON.stringify(rooms)) {
      writeStringList(storageKey, rooms);
    }
  } catch {
    // catch-no-log-ok localStorage may be unavailable
  }
  return rooms;
}

export function loadRrcRoomFavourites(hubHash: string): string[] {
  return loadCanonicalList(FAV_PREFIX + hubHash.toLowerCase());
}

export function saveRrcRoomFavourites(hubHash: string, rooms: string[]): void {
  writeStringList(FAV_PREFIX + hubHash.toLowerCase(), canonicalizeRoomList(rooms));
}

export function toggleRrcRoomFavourite(hubHash: string, room: string): string[] {
  const key = rrcRoomMatchKey(room);
  const prev = loadRrcRoomFavourites(hubHash);
  const next = prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key];
  saveRrcRoomFavourites(hubHash, next);
  return next;
}

export function loadRrcAutoJoinRooms(hubHash: string): string[] {
  return loadCanonicalList(AUTO_PREFIX + hubHash.toLowerCase());
}

export function saveRrcAutoJoinRooms(hubHash: string, rooms: string[]): void {
  writeStringList(AUTO_PREFIX + hubHash.toLowerCase(), canonicalizeRoomList(rooms));
}

export function toggleRrcAutoJoinRoom(hubHash: string, room: string): string[] {
  const key = rrcRoomMatchKey(room);
  const prev = loadRrcAutoJoinRooms(hubHash);
  const next = prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key];
  saveRrcAutoJoinRooms(hubHash, next);
  return next;
}
