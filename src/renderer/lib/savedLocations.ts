import { useSyncExternalStore } from 'react';

import {
  clearStoredStaticGps,
  persistStoredStaticGps,
  readStoredStaticGps,
  subscribeStaticGpsChanged,
} from './gpsSource';
import { parseStoredJson } from './parseStoredJson';

export const SAVED_LOCATIONS_STORAGE_KEY = 'mesh-client:savedLocations';

/**
 * A named place the computer is used from (home, EOC, ...). The active entry is mirrored into
 * the App static GPS settings, so every existing static-position consumer keeps working.
 * An empty `name` renders as the localized default label.
 */
export interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** "This computer doesn't move": skip the launch confirmation for this location. */
  fixed?: boolean;
}

export interface SavedLocationsState {
  locations: SavedLocation[];
  activeId: string | null;
}

const COORD_EPSILON = 1e-6;
const EMPTY_STATE: SavedLocationsState = { locations: [], activeId: null };

let cached: SavedLocationsState | null = null;
const listeners = new Set<() => void>();

subscribeStaticGpsChanged(() => {
  invalidate();
});

function invalidate(): void {
  cached = null;
  for (const listener of listeners) listener();
}

function newLocationId(): string {
  return `loc-${crypto.randomUUID()}`;
}

function isValidLocation(value: unknown): value is SavedLocation {
  if (typeof value !== 'object' || value == null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.lat === 'number' &&
    typeof v.lon === 'number' &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lon)
  );
}

function readRawState(): SavedLocationsState | null {
  if (typeof localStorage === 'undefined') return null;
  const parsed = parseStoredJson<{ locations?: unknown; activeId?: unknown }>(
    localStorage.getItem(SAVED_LOCATIONS_STORAGE_KEY),
    'savedLocations readRawState',
  );
  if (!parsed) return null;
  const locations = Array.isArray(parsed.locations) ? parsed.locations.filter(isValidLocation) : [];
  const activeId =
    typeof parsed.activeId === 'string' && locations.some((l) => l.id === parsed.activeId)
      ? parsed.activeId
      : null;
  return { locations, activeId };
}

function writeRawState(state: SavedLocationsState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SAVED_LOCATIONS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // catch-no-log-ok localStorage quota or private mode
  }
}

function sameCoords(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < COORD_EPSILON && Math.abs(a.lon - b.lon) < COORD_EPSILON;
}

/**
 * Align saved locations with the static GPS settings, which other paths (Radio panel,
 * MeshCore advert sync) may write directly. Also performs the one-time migration of a
 * pre-existing static position into a saved location.
 */
function reconcile(raw: SavedLocationsState | null): SavedLocationsState {
  const base = raw ?? EMPTY_STATE;
  const staticGps = readStoredStaticGps();
  if (!staticGps) {
    return base.activeId == null ? base : { ...base, activeId: null };
  }
  const active = base.locations.find((l) => l.id === base.activeId);
  if (active && sameCoords(active, staticGps)) return base;
  const match = base.locations.find((l) => sameCoords(l, staticGps));
  if (match) return { ...base, activeId: match.id };
  const created: SavedLocation = {
    id: newLocationId(),
    name: '',
    lat: staticGps.lat,
    lon: staticGps.lon,
  };
  return { locations: [...base.locations, created], activeId: created.id };
}

export function readSavedLocations(): SavedLocationsState {
  if (cached) return cached;
  const raw = readRawState();
  const next = reconcile(raw);
  if (next !== raw && (raw != null || next.locations.length > 0)) {
    writeRawState(next);
  }
  cached = next;
  return next;
}

export function getActiveSavedLocation(): SavedLocation | null {
  const state = readSavedLocations();
  return state.locations.find((l) => l.id === state.activeId) ?? null;
}

function commit(state: SavedLocationsState): void {
  writeRawState(state);
  const active = state.locations.find((l) => l.id === state.activeId);
  cached = null;
  if (active) {
    // Saved locations own the position, so host GPS polling is turned off like the old form did.
    persistStoredStaticGps(active.lat, active.lon, { refreshInterval: 0 });
  } else {
    clearStoredStaticGps();
  }
  invalidate();
}

export function saveNewLocation(
  input: { name: string; lat: number; lon: number; fixed?: boolean },
  opts?: { activate?: boolean },
): SavedLocation {
  const state = readSavedLocations();
  const created: SavedLocation = {
    id: newLocationId(),
    name: input.name.trim(),
    lat: input.lat,
    lon: input.lon,
    ...(input.fixed ? { fixed: true } : {}),
  };
  const activate = opts?.activate !== false;
  commit({
    locations: [...state.locations, created],
    activeId: activate ? created.id : state.activeId,
  });
  return created;
}

export function activateSavedLocation(id: string): SavedLocation | null {
  const state = readSavedLocations();
  const target = state.locations.find((l) => l.id === id);
  if (!target) return null;
  commit({ ...state, activeId: id });
  return target;
}

export function updateSavedLocation(
  id: string,
  patch: Partial<Pick<SavedLocation, 'name' | 'lat' | 'lon' | 'fixed'>>,
): void {
  const state = readSavedLocations();
  if (!state.locations.some((l) => l.id === id)) return;
  commit({
    ...state,
    locations: state.locations.map((l) => {
      if (l.id !== id) return l;
      const next: SavedLocation = { ...l, ...patch };
      if (patch.name != null) next.name = patch.name.trim();
      if (!next.fixed) delete next.fixed;
      return next;
    }),
  });
}

export function deleteSavedLocation(id: string): void {
  const state = readSavedLocations();
  commit({
    locations: state.locations.filter((l) => l.id !== id),
    activeId: state.activeId === id ? null : state.activeId,
  });
}

/** Stop using any saved location (clears the static position). */
export function deactivateSavedLocation(): void {
  const state = readSavedLocations();
  if (state.activeId == null) return;
  commit({ ...state, activeId: null });
}

export function subscribeSavedLocations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSavedLocations(): SavedLocationsState {
  return useSyncExternalStore(subscribeSavedLocations, readSavedLocations, readSavedLocations);
}

/** Test-only: drop the in-memory snapshot after tests rewrite localStorage directly. */
export function resetSavedLocationsCacheForTests(): void {
  cached = null;
}
