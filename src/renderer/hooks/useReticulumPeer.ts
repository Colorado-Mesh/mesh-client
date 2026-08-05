import { useShallow } from 'zustand/react/shallow';

import { useReticulumPeerStore } from '../stores/reticulumPeerStore';

/**
 * Stable peer view for a destination hash.
 * `getPeer` may allocate a new merged object when contact/history and path-table
 * route fields differ — useShallow guards React 19 max-update-depth (#185).
 */
export function useReticulumPeer(peerHash: string) {
  return useReticulumPeerStore(useShallow((s) => s.getPeer(peerHash)));
}
