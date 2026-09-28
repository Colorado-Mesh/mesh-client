/**
 * Remember the RRC room (or DM) the user last opened on each hub, so a restart returns to it
 * instead of whichever room the hub JOINs first. Client-local; only user choices are saved.
 */

const ACTIVE_ROOM_PREFIX = 'mesh-client:rrc:activeRoom:';

function storageKey(hubHash: string): string {
  return ACTIVE_ROOM_PREFIX + hubHash.trim().toLowerCase();
}

export function loadRrcActiveRoom(hubHash: string): string | null {
  try {
    const room = localStorage.getItem(storageKey(hubHash))?.trim();
    return room ? room : null;
  } catch {
    // catch-no-log-ok localStorage may be unavailable
    return null;
  }
}

export function saveRrcActiveRoom(hubHash: string, room: string): void {
  try {
    localStorage.setItem(storageKey(hubHash), room.trim());
  } catch {
    // catch-no-log-ok localStorage may be unavailable
  }
}

export function clearRrcActiveRoom(hubHash: string): void {
  try {
    localStorage.removeItem(storageKey(hubHash));
  } catch {
    // catch-no-log-ok
  }
}
