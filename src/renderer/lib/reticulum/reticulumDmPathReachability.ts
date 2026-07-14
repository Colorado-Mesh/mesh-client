/** Path-reachability state for Reticulum DM header (transport path, not LXMF echo). */

export type ReticulumDmPathStatus = 'idle' | 'probing' | 'reachable' | 'unreachable';

/** Optimistic green when path-table or contact hops are already known. */
export function seedReticulumDmPathStatus(hops: number | null | undefined): ReticulumDmPathStatus {
  if (hops != null && hops >= 0) return 'reachable';
  return 'idle';
}

export function reticulumDmPathStatusFromProbe(ok: boolean): ReticulumDmPathStatus {
  return ok ? 'reachable' : 'unreachable';
}
