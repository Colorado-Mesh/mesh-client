import { meshcoreRoomHasSavedGuestCredential } from '@/renderer/lib/meshcoreRoomCredentialStorage';
import { meshcoreRoomCanPost } from '@/renderer/lib/meshcoreRoomSession';

/**
 * Whether a MeshCore room may appear as a Scheduled Broadcast destination.
 *
 * Eligible when the room can post already, or when a guest password was saved
 * (including an intentional blank guest) so deliver can log in via
 * {@link meshcoreRoomTryEnsureCanPost}. Admin-only credentials are not enough —
 * delivery uses guest SendLogin, not admin-only records.
 */
export function isScheduledBroadcastMeshcoreRoomEligible(nodeId: number): boolean {
  return meshcoreRoomCanPost(nodeId) || meshcoreRoomHasSavedGuestCredential(nodeId);
}
