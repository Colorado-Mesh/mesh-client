import { releaseReticulumBleRnodeConnect } from '@/renderer/lib/reticulum/reticulumBleAdapterConflict';
import { useReticulumDiscoveryMapStore } from '@/renderer/stores/reticulumDiscoveryMapStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

/** Clear Reticulum session-scoped UI stores and release Noble BLE yield on teardown. */
export function clearReticulumSessionStores(): void {
  useReticulumDiscoveryMapStore.getState().clear();
  useReticulumPeerStore.getState().clearPeers();
  useRrcSessionStore.getState().clearSession();
  useRrcSessionStore.setState({ unreadByHub: new Map() });
  useRrcHubStore.getState().clear();
  void releaseReticulumBleRnodeConnect();
}
