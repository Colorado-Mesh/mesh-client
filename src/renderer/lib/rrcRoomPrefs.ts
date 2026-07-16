const FAV_PREFIX = 'mesh-client:rrc:roomFavourites:';
const AUTO_PREFIX = 'mesh-client:rrc:autoJoin:';

function readStringList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
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

export function loadRrcRoomFavourites(hubHash: string): string[] {
  return readStringList(FAV_PREFIX + hubHash.toLowerCase());
}

export function saveRrcRoomFavourites(hubHash: string, rooms: string[]): void {
  writeStringList(FAV_PREFIX + hubHash.toLowerCase(), [
    ...new Set(rooms.map((r) => r.trim().toLowerCase()).filter(Boolean)),
  ]);
}

export function toggleRrcRoomFavourite(hubHash: string, room: string): string[] {
  const key = room.trim().toLowerCase();
  const prev = loadRrcRoomFavourites(hubHash);
  const next = prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key];
  saveRrcRoomFavourites(hubHash, next);
  return next;
}

export function loadRrcAutoJoinRooms(hubHash: string): string[] {
  return readStringList(AUTO_PREFIX + hubHash.toLowerCase());
}

export function saveRrcAutoJoinRooms(hubHash: string, rooms: string[]): void {
  writeStringList(AUTO_PREFIX + hubHash.toLowerCase(), [
    ...new Set(rooms.map((r) => r.trim().toLowerCase()).filter(Boolean)),
  ]);
}

export function toggleRrcAutoJoinRoom(hubHash: string, room: string): string[] {
  const key = room.trim().toLowerCase();
  const prev = loadRrcAutoJoinRooms(hubHash);
  const next = prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key];
  saveRrcAutoJoinRooms(hubHash, next);
  return next;
}
