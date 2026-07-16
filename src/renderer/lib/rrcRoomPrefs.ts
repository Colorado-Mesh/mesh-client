import { loadCanonicalStringList, writeStringList } from './localStorageList';
import { rrcRoomMatchKey } from './rrcRoomName';

const FAV_PREFIX = 'mesh-client:rrc:roomFavourites:';
const AUTO_PREFIX = 'mesh-client:rrc:autoJoin:';

function canonicalizeRoomList(rooms: string[]): string[] {
  return [...new Set(rooms.map((r) => rrcRoomMatchKey(r)).filter(Boolean))];
}

export function loadRrcRoomFavourites(hubHash: string): string[] {
  return loadCanonicalStringList(FAV_PREFIX + hubHash.toLowerCase(), canonicalizeRoomList);
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
  return loadCanonicalStringList(AUTO_PREFIX + hubHash.toLowerCase(), canonicalizeRoomList);
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
