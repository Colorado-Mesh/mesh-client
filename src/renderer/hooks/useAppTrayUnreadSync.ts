import { useEffect } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

const MESHTASTIC_UNREAD_KEY = 'mesh-client:meshtasticChatUnread';
const MESHCORE_UNREAD_KEY = 'mesh-client:meshcoreChatUnread';
const MESHCORE_ROOMS_UNREAD_KEY = 'mesh-client:meshcoreRoomsUnread';

function persistUnread(protocol: 'meshtastic' | 'meshcore', count: number): void {
  try {
    const key = protocol === 'meshcore' ? MESHCORE_UNREAD_KEY : MESHTASTIC_UNREAD_KEY;
    const n = Math.max(0, Math.min(Math.floor(count) || 0, 99999));
    localStorage.setItem(key, String(n));
  } catch (e) {
    console.debug('[App] persistUnread quota/private mode ' + errLikeToLogString(e));
  }
}

function persistMeshcoreRoomsUnread(count: number): void {
  try {
    const n = Math.max(0, Math.min(Math.floor(count) || 0, 99999));
    localStorage.setItem(MESHCORE_ROOMS_UNREAD_KEY, String(n));
  } catch (e) {
    console.debug('[App] persistMeshcoreRoomsUnread quota/private mode ' + errLikeToLogString(e));
  }
}

/** Persist per-protocol unread counts and sync combined total to the macOS tray badge. */
export function useAppTrayUnreadSync(
  meshtasticChatUnread: number,
  meshcoreChatUnread: number,
  meshcoreRoomsUnread: number,
): void {
  useEffect(() => {
    persistUnread('meshtastic', meshtasticChatUnread);
  }, [meshtasticChatUnread]);

  useEffect(() => {
    persistUnread('meshcore', meshcoreChatUnread);
  }, [meshcoreChatUnread]);

  useEffect(() => {
    persistMeshcoreRoomsUnread(meshcoreRoomsUnread);
  }, [meshcoreRoomsUnread]);

  useEffect(() => {
    window.electronAPI.setTrayUnread(
      meshtasticChatUnread + meshcoreChatUnread + meshcoreRoomsUnread,
    );
  }, [meshtasticChatUnread, meshcoreChatUnread, meshcoreRoomsUnread]);
}
