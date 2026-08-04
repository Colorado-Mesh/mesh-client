/**
 * Resolve a human label for the voice overlay remote_identity field
 * (identity hash or LXMF destination hash).
 */

import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import {
  resolveReticulumPeerLabel,
  useReticulumPeerStore,
} from '@/renderer/stores/reticulumPeerStore';
import type { ReticulumPeer } from '@/shared/reticulum-types';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

function labelForPeerMaps(key: string, maps: Iterable<Map<string, ReticulumPeer>>): string | null {
  for (const map of maps) {
    for (const peer of map.values()) {
      const id = peer.identity_hash
        ? canonicalizeReticulumDestinationHash(peer.identity_hash)
        : null;
      if (id === key) return resolveReticulumPeerLabel(peer);
    }
  }
  return null;
}

/**
 * Prefer peer/contact display name for a voice remote hash; fall back to a short hash prefix.
 */
export function resolveReticulumVoiceRemoteLabel(remoteIdentity: string): string {
  const key = canonicalizeReticulumDestinationHash(remoteIdentity);
  if (!key) {
    const trimmed = remoteIdentity.trim();
    return trimmed || remoteIdentity;
  }

  const peerStore = useReticulumPeerStore.getState();
  const direct = peerStore.getPeer(key);
  if (direct) return resolveReticulumPeerLabel(direct);

  const byIdentity = labelForPeerMaps(key, [
    peerStore.contacts,
    peerStore.history,
    peerStore.peers,
  ]);
  if (byIdentity) return byIdentity;

  // Reverse-map via identity-activity rows (identity → LXMF dest → peer name).
  for (const [dest, rows] of useReticulumIdentityActivityStore.getState().byDestination) {
    for (const row of rows) {
      const id = row.identity_hash ? canonicalizeReticulumDestinationHash(row.identity_hash) : null;
      if (id !== key && dest !== key) continue;
      const peer = peerStore.getPeer(dest);
      if (peer) return resolveReticulumPeerLabel(peer);
    }
  }

  return key.slice(0, 12);
}
