import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { useLocationPromptStore } from '../stores/locationPromptStore';
import type { OurPosition } from './gpsSource';
import { getLocationTrust, type LocationTrust, type OurPositionReference } from './locationTrust';
import {
  getActiveSavedLocation,
  subscribeSavedLocations,
  useSavedLocations,
} from './savedLocations';

let lastPublished: OurPosition | null = null;
let subscribed = false;

function buildReference(pos: OurPosition | null): OurPositionReference | null {
  if (!pos) return null;
  const trust = getLocationTrust(
    pos,
    getActiveSavedLocation(),
    useLocationPromptStore.getState().confirmedLocationId,
  );
  return { lat: pos.lat, lon: pos.lon, source: pos.source, trust };
}

function republish(): void {
  useDiagnosticsStore.getState().setOurPositionReference(buildReference(lastPublished));
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  // Confirming or switching a saved location changes trust without a new position fix.
  useLocationPromptStore.subscribe((state, prev) => {
    if (state.confirmedLocationId !== prev.confirmedLocationId) republish();
  });
  subscribeSavedLocations(republish);
}

/** Called by the active protocol runtime after each position resolve. */
export function publishOurPositionReference(pos: OurPosition | null): void {
  ensureSubscribed();
  lastPublished = pos;
  republish();
  useLocationPromptStore.getState().markPositionResolved();
}

/** Trust for a position shown in UI (startup strip, Diagnostics card). */
export function useLocationTrust(position: OurPosition | null | undefined): LocationTrust {
  const saved = useSavedLocations();
  const confirmedLocationId = useLocationPromptStore((s) => s.confirmedLocationId);
  const active = saved.locations.find((l) => l.id === saved.activeId) ?? null;
  return getLocationTrust(position, active, confirmedLocationId);
}
