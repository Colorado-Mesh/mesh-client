import { releaseReticulumBleRnodeConnect } from '@/renderer/lib/reticulum/reticulumBleAdapterConflict';
import { useReticulumDiscoveryMapStore } from '@/renderer/stores/reticulumDiscoveryMapStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';

/** Clear Reticulum session-scoped UI stores and release Noble BLE yield on teardown. */
export function clearReticulumSessionStores(): void {
  useReticulumDiscoveryMapStore.getState().clear();
  useReticulumPeerStore.getState().clearPeers();
  void releaseReticulumBleRnodeConnect();
}
