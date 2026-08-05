import { releaseReticulumBleRnodeConnect } from '@/renderer/lib/reticulum/reticulumBleAdapterConflict';
import { stopReticulumVoiceMedia } from '@/renderer/lib/reticulumVoiceSession';
import { useReticulumDiscoveryMapStore } from '@/renderer/stores/reticulumDiscoveryMapStore';
import { useReticulumGamesStore } from '@/renderer/stores/reticulumGamesStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';
import { useRnshSessionStore } from '@/renderer/stores/rnshSessionStore';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import { isReticulumVoiceSessionBusy } from '@/shared/voice-types';

/** Clear Reticulum session-scoped UI stores and release Noble BLE yield on teardown. */
export function clearReticulumSessionStores(): void {
  useReticulumDiscoveryMapStore.getState().clear();
  useReticulumPeerStore.getState().clearPeers();
  useRrcSessionStore.getState().clearSession();
  useRrcSessionStore.setState({ unreadByHub: new Map() });
  useRrcHubStore.getState().clear();
  useRnshSessionStore.getState().clearAll();
  useRncpTransferStore.getState().clearAll();
  useReticulumGamesStore.getState().clear();
  const voiceState = useReticulumVoiceStore.getState();
  if (isReticulumVoiceSessionBusy(voiceState.activeCall ?? voiceState.incomingCall)) {
    // Best-effort sidecar hangup before local clear (stack may already be dead).
    try {
      void window.electronAPI.reticulum.voice.hangup().catch(() => {
        // catch-no-log-ok teardown hangup when sidecar is already gone
      });
    } catch {
      // catch-no-log-ok electronAPI/voice unavailable during teardown
    }
  }
  stopReticulumVoiceMedia();
  useReticulumVoiceStore.getState().clearCall();
  void releaseReticulumBleRnodeConnect();
}
