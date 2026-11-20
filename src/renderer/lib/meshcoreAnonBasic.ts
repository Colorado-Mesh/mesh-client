/**
 * ANON_REQ BASIC (0x03) display helpers for the node detail modal.
 */

import type { MeshcoreAnonBasicParsed } from './meshcoreAnonRequestRpc';

export type MeshcoreAnonBasicStatus = 'ok' | 'error' | 'unsupported';

export interface MeshcoreAnonBasicEntry {
  status: MeshcoreAnonBasicStatus;
  fetchedAt: number;
  clock?: number;
  features?: number;
  isBridge?: boolean;
  bridgeKind?: 'uart' | 'espnow' | null;
  forwardingDisabled?: boolean;
  reason?: string;
}

export function meshcoreAnonBasicFromParsed(
  parsed: MeshcoreAnonBasicParsed,
  fetchedAt = Date.now(),
): MeshcoreAnonBasicEntry {
  return {
    status: 'ok',
    fetchedAt,
    clock: parsed.clock,
    features: parsed.features,
    isBridge: parsed.isBridge,
    bridgeKind: parsed.bridgeKind,
    forwardingDisabled: parsed.forwardingDisabled,
  };
}

/** Seconds of skew: positive means remote clock is ahead of local. */
export function meshcoreAnonClockSkewSeconds(remoteClockSec: number, nowMs = Date.now()): number {
  return remoteClockSec - Math.floor(nowMs / 1000);
}
