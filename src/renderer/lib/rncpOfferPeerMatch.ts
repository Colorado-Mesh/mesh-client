import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

/**
 * Collect identity hashes that may identify the same peer as an LXMF DM destination.
 * Used to match rncp pending offers (gated on LinkIdentify identity_hash) to a Chat DM.
 */
export function collectIdentityHashesForLxmfPeer(lxmfPeerHash: string): Set<string> {
  const out = new Set<string>();
  const dest = canonicalizeReticulumDestinationHash(lxmfPeerHash);
  if (!dest) return out;

  const activity = useReticulumIdentityActivityStore.getState().getActivity(dest);
  for (const row of activity) {
    const id = row.identity_hash ? canonicalizeReticulumDestinationHash(row.identity_hash) : null;
    if (id) out.add(id);
  }

  const saved = useReticulumRemoteAddressStore.getState().findByLxmfPeer(dest);
  const savedId = saved?.identity_hash
    ? canonicalizeReticulumDestinationHash(saved.identity_hash)
    : null;
  if (savedId) out.add(savedId);

  return out;
}

/** True when an rncp offer's identity_hash belongs to the open LXMF DM peer. */
export function rncpOfferMatchesLxmfPeer(
  offerIdentityHash: string | null | undefined,
  lxmfPeerHash: string,
): boolean {
  const offerId = offerIdentityHash
    ? canonicalizeReticulumDestinationHash(offerIdentityHash)
    : null;
  if (!offerId) return false;
  return collectIdentityHashesForLxmfPeer(lxmfPeerHash).has(offerId);
}
