import { useEffect } from 'react';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import { enqueueTakChatRelay, listTakSendRooms } from '../lib/tak/takInboundChat';
import { sendTakTextOnMesh } from '../lib/tak/takMeshSend';
import { useIdentityStore } from '../stores/identityStore';
import { useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { useTakSinkStore } from '../stores/takSinkStore';

/**
 * Sends GeoChat messages from local TAK clients on the mesh channels bridged to their room, for
 * channels the user allowed TAK to send to, one message at a time in arrival order. Also keeps
 * main told which rooms those are, so it can offer each to TAK clients as a contact to message.
 * Mount once from AppContent.
 */
export function useTakInboundChat(): void {
  useEffect(() => {
    return window.electronAPI.tak.onInboundChat((message) => {
      void enqueueTakChatRelay(message, sendTakTextOnMesh);
    });
  }, []);

  const sinkActive = useTakSinkStore((s) => s.active);
  const relayPrefs = useTakRelayPrefsStore((s) => s.byIdentity);
  const identities = useIdentityStore((s) => s.identities);
  useEffect(() => {
    // Main keeps the list only while a sink exists, so it is sent again whenever one starts.
    if (!sinkActive) return;
    window.electronAPI.tak.setChatSendRooms(listTakSendRooms()).catch((e: unknown) => {
      console.warn('[TakInboundChat] setChatSendRooms failed ' + errLikeToLogString(e));
    });
  }, [sinkActive, relayPrefs, identities]);
}
