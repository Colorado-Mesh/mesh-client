import { clampReadWatermarkMs } from './nodeStatus';
import { parseStoredJson } from './parseStoredJson';
import { rrcRoomMatchKey } from './rrcRoomName';

const openings = new Map<string, number>();
let failedRepair: { raw: string | null; value: Partial<Record<string, number>> } | undefined;
export const rrcLastReadStorageKey = () => 'mesh-client:lastRead:rrc';
export const rrcReadKey = (hub: string, room: string) =>
  `${hub.trim().toLowerCase()}::${rrcRoomMatchKey(room) || room.trim().toLowerCase()}`;
export function loadPersistedRrcLastRead(): Partial<Record<string, number>> {
  try {
    const raw = localStorage.getItem(rrcLastReadStorageKey());
    const now = Date.now();
    if (failedRepair?.raw === raw)
      return Object.fromEntries(
        Object.entries(failedRepair.value).map(([key, at]) => [
          key,
          clampReadWatermarkMs(at ?? 0, now, 0),
        ]),
      );
    failedRepair = undefined;
    const value = parseStoredJson<Record<string, unknown>>(raw, 'RRC last read');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const entries = Object.entries(value).filter(([, v]) => typeof v === 'number');
    const clamped = Object.fromEntries(
      entries.map(([k, v]) => [k, clampReadWatermarkMs(Number(v), now, 0)]),
    );
    // Persist legacy repairs once so the boundary cannot advance on every read.
    // This getter can run during render; do not emit a store change event here.
    if (entries.some(([key, at]) => clamped[key] !== at)) {
      try {
        localStorage.setItem(rrcLastReadStorageKey(), JSON.stringify(clamped));
      } catch {
        // catch-no-log-ok keep the repaired boundary stable in memory if storage is read-only
        failedRepair = { raw, value: clamped };
      }
    }
    return clamped;
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
  const now = Date.now();
  value[key] = Math.max(
    clampReadWatermarkMs(value[key] ?? 0, now, 0),
    clampReadWatermarkMs(at, now, 0),
  );
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
  const now = Date.now();
  const firstUnread =
    unread !== undefined && unread > 0 && messages.length >= unread
      ? messages[messages.length - unread]?.timestamp
      : undefined;
  const fallback =
    unread !== undefined && unread > 0
      ? firstUnread !== undefined && Number.isFinite(firstUnread) && firstUnread > 0
        ? clampReadWatermarkMs(firstUnread - 1, now, 0)
        : now
      : messages.reduce(
          (latest, message) => Math.max(latest, clampReadWatermarkMs(message.timestamp, now, 0)),
          0,
        ) || now;
  openings.set(key, stored ?? fallback);
  if (openings.size > 200) openings.delete(openings.keys().next().value!);
}
export function openingRrcReadWatermark(hub: string, room: string): number {
  return (
    openings.get(rrcReadKey(hub, room)) ?? loadPersistedRrcLastRead()[rrcReadKey(hub, room)] ?? 0
  );
}
