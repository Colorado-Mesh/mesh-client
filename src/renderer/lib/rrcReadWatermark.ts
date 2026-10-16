import { clampReadWatermarkMs } from './nodeStatus';
import { parseStoredJson } from './parseStoredJson';
import { rrcRoomMatchKey } from './rrcRoomName';

const openings = new Map<string, number>();
export const rrcLastReadStorageKey = () => 'mesh-client:lastRead:rrc';
export const rrcReadKey = (hub: string, room: string) =>
  `${hub.trim().toLowerCase()}::${rrcRoomMatchKey(room) || room.trim().toLowerCase()}`;
export function loadPersistedRrcLastRead(): Partial<Record<string, number>> {
  try {
    const value = parseStoredJson<Record<string, unknown>>(
      localStorage.getItem(rrcLastReadStorageKey()),
      'RRC last read',
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => [k, clampReadWatermarkMs(Number(v))]),
    );
  } catch {
    // catch-no-log-ok unavailable storage leaves messages unread
    return {};
  }
}
export function savePersistedRrcLastRead(value: Partial<Record<string, number>>): void {
  try {
    localStorage.setItem(rrcLastReadStorageKey(), JSON.stringify(value));
    window.dispatchEvent(new Event('mesh-client:rrcLastReadChanged'));
  } catch {
    // catch-no-log-ok read state is optional when storage is unavailable
  }
}
export function mergeRrcReadWatermark(hub: string, room: string, at: number): void {
  const value = loadPersistedRrcLastRead();
  const key = rrcReadKey(hub, room);
  value[key] = Math.max(value[key] ?? 0, clampReadWatermarkMs(at));
  savePersistedRrcLastRead(value);
}
export function snapshotRrcReadWatermark(
  hub: string,
  room: string,
  unread?: number,
  messages: readonly { timestamp: number }[] = [],
): void {
  const key = rrcReadKey(hub, room);
  const stored = loadPersistedRrcLastRead()[key];
  const fallback =
    unread !== undefined && unread > 0
      ? messages.length >= unread
        ? messages[messages.length - unread].timestamp - 1
        : 0
      : messages.reduce(
          (latest, message) => Math.max(latest, message.timestamp),
          messages.length ? 0 : Date.now(),
        );
  openings.set(key, stored ?? fallback);
  if (openings.size > 200) openings.delete(openings.keys().next().value!);
}
export function openingRrcReadWatermark(hub: string, room: string): number {
  return (
    openings.get(rrcReadKey(hub, room)) ?? loadPersistedRrcLastRead()[rrcReadKey(hub, room)] ?? 0
  );
}
