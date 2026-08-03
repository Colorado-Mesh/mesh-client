/**
 * Soft LXST telephony capability from identity-activity announces.
 * Unknown ≠ incompatible — Call stays enabled when aspect has not been heard.
 */

import type { ReticulumIdentityActivityRow } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

export const LXST_TELEPHONY_ASPECT = 'lxst.telephony';

export type LxstTelephonyCapability = 'heard' | 'unknown';

export function activityShowsLxstTelephony(
  rows: Iterable<ReticulumIdentityActivityRow>,
  identityHash?: string | null,
): boolean {
  const id = identityHash ? canonicalizeReticulumDestinationHash(identityHash) : null;
  for (const row of rows) {
    if (row.aspect !== LXST_TELEPHONY_ASPECT) continue;
    if (!id) return true;
    const rowId = row.identity_hash
      ? canonicalizeReticulumDestinationHash(row.identity_hash)
      : null;
    if (rowId && rowId === id) return true;
    // Activity keyed on telephony destination for this identity — match dest load below.
    if (!rowId) return true;
  }
  return false;
}

/**
 * Soft capability for Call UI: `heard` when any lxst.telephony activity matches the
 * peer LXMF dest and/or known identity hash.
 */
export function peerLxstTelephonyCapability(opts: {
  lxmfPeerHash: string;
  identityHash?: string | null;
}): LxstTelephonyCapability {
  const dest = canonicalizeReticulumDestinationHash(opts.lxmfPeerHash);
  if (!dest) return 'unknown';
  const store = useReticulumIdentityActivityStore.getState();
  const destRows = store.getActivity(dest);
  if (activityShowsLxstTelephony(destRows, opts.identityHash)) return 'heard';

  const id = opts.identityHash ? canonicalizeReticulumDestinationHash(opts.identityHash) : null;
  if (id) {
    const idRows = store.getActivity(id);
    if (activityShowsLxstTelephony(idRows, id)) return 'heard';
    // Scan all cached destinations for telephony aspect tied to this identity.
    for (const rows of store.byDestination.values()) {
      if (activityShowsLxstTelephony(rows, id)) return 'heard';
    }
  }
  return 'unknown';
}
