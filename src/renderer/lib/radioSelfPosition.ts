import type { MeshProtocol } from '@/shared/meshProtocol';

import { validateCoords } from './coordUtils';

/**
 * Position the connected radio itself reported this session (NodeDB self row, self Position
 * packet, MeshCore self-info advert). Kept apart from the self node row because that row also
 * holds app-resolved positions and SQLite-restored coordinates, which must never be read back
 * as device GPS.
 */
export interface RadioSelfPosition {
  lat: number;
  lon: number;
  altitudeMeters?: number;
  receivedAt: number;
}

const byProtocol = new Map<MeshProtocol, RadioSelfPosition>();

export function recordRadioSelfPosition(
  protocol: MeshProtocol,
  lat: number | null | undefined,
  lon: number | null | undefined,
  altitudeMeters?: number | null,
): void {
  if (lat == null || lon == null) return;
  if (!validateCoords(lat, lon).valid) return;
  const entry: RadioSelfPosition = { lat, lon, receivedAt: Date.now() };
  if (typeof altitudeMeters === 'number' && Number.isFinite(altitudeMeters)) {
    entry.altitudeMeters = altitudeMeters;
  }
  byProtocol.set(protocol, entry);
}

export function readRadioSelfPosition(protocol: MeshProtocol): RadioSelfPosition | null {
  return byProtocol.get(protocol) ?? null;
}

export function clearRadioSelfPosition(protocol: MeshProtocol): void {
  byProtocol.delete(protocol);
}
