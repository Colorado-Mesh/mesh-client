import { getMeshcoreRoomCredential } from '@/renderer/lib/meshcoreRoomCredentialStorage';
import { meshcoreRoomCanPost } from '@/renderer/lib/meshcoreRoomSession';

/**
 * MeshCore rooms offered as Scheduled Broadcast targets: currently able to post,
 * or a saved password (so deliver can log in when the schedule fires).
 */
export function isScheduledBroadcastMeshcoreRoomEligible(nodeId: number): boolean {
  return meshcoreRoomCanPost(nodeId) || getMeshcoreRoomCredential(nodeId) != null;
}
