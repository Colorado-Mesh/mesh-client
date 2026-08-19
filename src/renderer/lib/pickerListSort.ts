import { useEffect, useMemo, useRef, useState } from 'react';

import { PICKER_RSSI_REORDER_DEBOUNCE_MS } from './timeConstants';

export type PickerSortKey = 'name' | 'rssi';
export type PickerSortDir = 'asc' | 'desc';
export type PickerSortMode = 'ble' | 'serial';

export interface PickerSortPreference {
  key: PickerSortKey;
  dir: PickerSortDir;
}

export interface PickerSortAccessors<T> {
  getName: (item: T) => string;
  getId: (item: T) => string;
  getRssi?: (item: T) => number | null | undefined;
}

export const DEFAULT_BLE_PICKER_SORT: PickerSortPreference = { key: 'rssi', dir: 'desc' };
export const DEFAULT_SERIAL_PICKER_SORT: PickerSortPreference = { key: 'name', dir: 'asc' };

/** Default direction when switching to a key (RSSI = strongest first). */
export function defaultPickerSortDir(key: PickerSortKey): PickerSortDir {
  return key === 'rssi' ? 'desc' : 'asc';
}

export function defaultPickerSort(mode: PickerSortMode): PickerSortPreference {
  return mode === 'ble' ? { ...DEFAULT_BLE_PICKER_SORT } : { ...DEFAULT_SERIAL_PICKER_SORT };
}

export function nextPickerSort(
  current: PickerSortPreference,
  clickedKey: PickerSortKey,
): PickerSortPreference {
  if (current.key === clickedKey) {
    return { key: current.key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: clickedKey, dir: defaultPickerSortDir(clickedKey) };
}

/** Display name used for BLE picker rows and Name sort (cached name + advertised). */
export function blePickerDisplayName(
  deviceId: string,
  advertisedName: string | null | undefined,
  cachedName: string | null | undefined,
): string {
  const advertised = advertisedName?.trim() || null;
  const cached = cachedName?.trim() || null;
  if (cached) {
    if (advertised && advertised !== cached) return `${cached} (${advertised})`;
    return cached;
  }
  return advertised ?? deviceId;
}

function finiteRssi(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function itemSortName<T>(item: T, accessors: PickerSortAccessors<T>): string {
  const name = accessors.getName(item).trim();
  return name || accessors.getId(item);
}

function compareNullableNumber(a: number | null, b: number | null, sign: number): number | null {
  if (a == null && b == null) return null;
  if (a == null) return 1;
  if (b == null) return -1;
  return sign * (a - b);
}

function idSetEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  for (const id of a) {
    if (!setB.has(id)) return false;
  }
  return true;
}

function idArrayEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Keep existing IDs in committed order; insert newcomers at their fully-sorted rank. */
function mergePickerOrderOnMembershipChange(
  committedIds: readonly string[],
  sortedIds: readonly string[],
): string[] {
  const committedSet = new Set(committedIds);
  const nextSet = new Set(sortedIds);
  const kept = committedIds.filter((id) => nextSet.has(id));
  const rank = new Map(sortedIds.map((id, i) => [id, i]));
  const merged = [...kept];
  for (const id of sortedIds) {
    if (committedSet.has(id)) continue;
    const newRank = rank.get(id) ?? Number.MAX_SAFE_INTEGER;
    let insertAt = merged.length;
    for (let i = 0; i < merged.length; i++) {
      if ((rank.get(merged[i]) ?? Number.MAX_SAFE_INTEGER) > newRank) {
        insertAt = i;
        break;
      }
    }
    merged.splice(insertAt, 0, id);
  }
  return merged;
}

/** Sort a picker list. Missing RSSI is always last. Tie-break on id. */
export function sortPickerItems<T>(
  items: readonly T[],
  key: PickerSortKey,
  dir: PickerSortDir,
  accessors: PickerSortAccessors<T>,
): T[] {
  const next = [...items];
  const sign = dir === 'asc' ? 1 : -1;
  next.sort((a, b) => {
    const nameA = itemSortName(a, accessors);
    const nameB = itemSortName(b, accessors);
    if (key === 'rssi') {
      const byRssi = compareNullableNumber(
        finiteRssi(accessors.getRssi?.(a)),
        finiteRssi(accessors.getRssi?.(b)),
        sign,
      );
      if (byRssi != null && byRssi !== 0) return byRssi;
    } else {
      const byName = sign * nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      if (byName !== 0) return byName;
    }
    const byNameAz = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    if (byNameAz !== 0) return byNameAz;
    return accessors.getId(a).localeCompare(accessors.getId(b));
  });
  return next;
}

function remapById<T>(
  orderIds: readonly string[],
  items: readonly T[],
  sortedFallback: readonly T[],
  getId: (item: T) => string,
): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    byId.set(getId(item), item);
  }
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const id of orderIds) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      seen.add(id);
    }
  }
  for (const item of sortedFallback) {
    const id = getId(item);
    if (!seen.has(id)) {
      ordered.push(item);
      seen.add(id);
    }
  }
  return ordered;
}

/**
 * Name sort is immediate. User changes to RSSI key/direction are immediate.
 * Live RSSI advertisements keep the previous row order until
 * {@link PICKER_RSSI_REORDER_DEBOUNCE_MS} elapses. Add/remove updates membership
 * immediately while preserving the committed relative order of existing IDs;
 * RSSI-only reordering of those IDs still waits for the debounce.
 * Item payloads (live dBm) always come from `items`.
 */
export function useDebouncedPickerSort<T>(
  items: readonly T[],
  key: PickerSortKey,
  dir: PickerSortDir,
  accessors: PickerSortAccessors<T>,
): T[] {
  const { getName, getId, getRssi } = accessors;
  const fullySorted = useMemo(
    () => sortPickerItems(items, key, dir, { getName, getId, getRssi }),
    [items, key, dir, getName, getId, getRssi],
  );

  const committedIdsRef = useRef<string[]>([]);
  const committedKeyRef = useRef<PickerSortKey>(key);
  const committedDirRef = useRef<PickerSortDir>(dir);
  const [orderIds, setOrderIds] = useState<string[]>(() => fullySorted.map(getId));

  useEffect(() => {
    const nextIds = fullySorted.map(getId);
    const keyOrDirChanged = committedKeyRef.current !== key || committedDirRef.current !== dir;
    const applyNow = () => {
      committedIdsRef.current = nextIds;
      committedKeyRef.current = key;
      committedDirRef.current = dir;
      setOrderIds(nextIds);
    };
    if (key !== 'rssi' || keyOrDirChanged) {
      applyNow();
      return;
    }
    const prev = committedIdsRef.current;
    const membershipChanged = !idSetEquals(prev, nextIds);
    if (prev.length === 0) {
      applyNow();
      return;
    }
    if (membershipChanged) {
      const merged = mergePickerOrderOnMembershipChange(prev, nextIds);
      committedIdsRef.current = merged;
      setOrderIds(merged);
      if (idArrayEquals(merged, nextIds)) return;
      const timer = window.setTimeout(() => {
        applyNow();
      }, PICKER_RSSI_REORDER_DEBOUNCE_MS);
      return () => {
        window.clearTimeout(timer);
      };
    }
    if (idArrayEquals(prev, nextIds)) return;
    const timer = window.setTimeout(() => {
      applyNow();
    }, PICKER_RSSI_REORDER_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [dir, fullySorted, getId, key]);

  return useMemo(
    () => remapById(orderIds, items, fullySorted, getId),
    [fullySorted, getId, items, orderIds],
  );
}
