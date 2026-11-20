/**
 * MeshCom chat destination → channel index (ALL / GRC group / DM).
 */

import { callsignToNodeId, normalizeMeshcomCallsign } from './meshcomCallsign';

export interface MeshcomDestResolved {
  /** Wire destination: `*`, decimal group id, or callsign. */
  wireDest: string;
  /** 0 = ALL, positive = GRC group, -1 = DM. */
  channelIndex: number;
  /** DM peer node id when channelIndex === -1; otherwise 0. */
  toNodeId: number;
}

/** True when `dest` is a MeshCom GRC group id (1–99999, digits only). */
export function isMeshcomGroupDest(dest: string): boolean {
  if (!/^\d{1,5}$/.test(dest)) return false;
  const n = Number.parseInt(dest, 10);
  return n >= 1 && n <= 99999;
}

/**
 * Resolve a MeshCom destination string (EXTUDP `dst`, APRS dest call, chat pill).
 * Groups are numeric; `*` / empty → ALL; otherwise DM callsign.
 */
export function resolveMeshcomDestination(dest: string | undefined | null): MeshcomDestResolved {
  const raw = (dest ?? '').trim();
  if (!raw || raw === '*') {
    return { wireDest: '*', channelIndex: 0, toNodeId: 0 };
  }
  if (isMeshcomGroupDest(raw)) {
    return {
      wireDest: String(Number.parseInt(raw, 10)),
      channelIndex: Number.parseInt(raw, 10),
      toNodeId: 0,
    };
  }
  const call = normalizeMeshcomCallsign(raw);
  if (!call) {
    return { wireDest: '*', channelIndex: 0, toNodeId: 0 };
  }
  return { wireDest: call, channelIndex: -1, toNodeId: callsignToNodeId(call) };
}

/**
 * Pick outbound wire destination from `SendMessageOptions`-style fields.
 * Positive `channelIndex` wins (GRC group); else DM/`*` from `destinationCallsign`.
 */
export function meshcomOutboundDest(opts: {
  channelIndex?: number;
  destinationCallsign?: string;
}): string {
  const ch = opts.channelIndex;
  if (typeof ch === 'number' && Number.isInteger(ch) && ch > 0 && ch <= 99999) {
    return String(ch);
  }
  const call = (opts.destinationCallsign ?? '').trim();
  if (!call || call === '*') return '*';
  if (isMeshcomGroupDest(call)) return String(Number.parseInt(call, 10));
  return normalizeMeshcomCallsign(call) || '*';
}
