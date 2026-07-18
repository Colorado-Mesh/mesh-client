import { releaseReticulumBleRnodeConnect } from '@/renderer/lib/reticulum/reticulumBleAdapterConflict';
import { useReticulumDiscoveryMapStore } from '@/renderer/stores/reticulumDiscoveryMapStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';
import { useRnshSessionStore } from '@/renderer/stores/rnshSessionStore';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

/** Clear Reticulum session-scoped UI stores and release Noble BLE yield on teardown. */
export function clearReticulumSessionStores(): void {
  useReticulumDiscoveryMapStore.getState().clear();
  useReticulumPeerStore.getState().clearPeers();
  useRrcSessionStore.getState().clearSession();
  useRrcSessionStore.setState({ unreadByHub: new Map() });
  useRrcHubStore.getState().clear();
  useRnshSessionStore.getState().clearAll();
  useRncpTransferStore.getState().clearAll();
  void releaseReticulumBleRnodeConnect();
}
