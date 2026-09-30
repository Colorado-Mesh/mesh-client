import type { GpsSource, OurPosition } from './gpsSource';
import type { SavedLocation } from './savedLocations';
import type { MeshNode } from './types';

/**
 * How far our resolved position can be trusted as the reference for distance-based diagnostics.
 * - `trusted`: radio GPS, or a saved location confirmed this session (or marked fixed).
 * - `needsConfirm`: a saved location that may be stale because the computer can move.
 * - `approximate`: city-level IP / browser positioning.
 * - `unknown`: no position at all.
 */
export type LocationTrust = 'trusted' | 'needsConfirm' | 'approximate' | 'unknown';

export interface OurPositionReference {
  lat: number;
  lon: number;
  source: GpsSource;
  trust: LocationTrust;
}

export function getLocationTrust(
  position: Pick<OurPosition, 'source'> | null | undefined,
  activeLocation: Pick<SavedLocation, 'id' | 'fixed'> | null | undefined,
  confirmedLocationId: string | null | undefined,
): LocationTrust {
  if (!position) return 'unknown';
  switch (position.source) {
    case 'device':
      return 'trusted';
    case 'ip':
    case 'browser':
      return 'approximate';
    case 'static':
      if (activeLocation?.fixed || (activeLocation && confirmedLocationId === activeLocation.id)) {
        return 'trusted';
      }
      return 'needsConfirm';
  }
}

/**
 * Home node used by distance checks (Impossible hop, Hop goblin, suboptimal route). Coordinates
 * come only from a trusted reference; otherwise they are cleared so those checks skip instead of
 * measuring from an approximate or possibly stale position.
 */
export function homeNodeForDistanceChecks(
  homeNode: MeshNode | null,
  reference: OurPositionReference | null,
): MeshNode | null {
  if (!homeNode) return null;
  if (reference?.trust === 'trusted') {
    return { ...homeNode, latitude: reference.lat, longitude: reference.lon };
  }
  if (homeNode.latitude == null && homeNode.longitude == null) return homeNode;
  return { ...homeNode, latitude: null, longitude: null };
}
