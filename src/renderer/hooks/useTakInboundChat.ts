import { useEffect, useMemo } from 'react';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import { enqueueTakChatRelay, listTakSendRooms } from '../lib/tak/takInboundChat';
import { sendTakTextOnMesh } from '../lib/tak/takMeshSend';
import { useIdentityStore } from '../stores/identityStore';
import { useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { useTakSinkStore } from '../stores/takSinkStore';

/** First wait before re-sending a refused room list; it doubles up to the maximum. */
export const TAK_SEND_ROOMS_RETRY_MS = 5_000;
export const TAK_SEND_ROOMS_RETRY_MAX_MS = 60_000;

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
  // The stores change for many reasons that leave the room list alone. Keying the effect on the
  // list's contents sends main one update per real change, well inside its rate limit. Room names
  // hold no control characters, so a newline cannot occur inside one.
  const roomsKey = useMemo(
    () => listTakSendRooms(identities, relayPrefs).join('\n'),
    [relayPrefs, identities],
  );
  useEffect(() => {
    // Main keeps the list only while a sink exists, so it is sent again whenever one starts.
    if (!sinkActive) return;
    const rooms = roomsKey ? roomsKey.split('\n') : [];
    // A refused update (main's rate limit, say) would leave main with an old list, so it is
    // retried, waiting longer each time, until it lands or a newer list or unmount replaces it.
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let delayMs = TAK_SEND_ROOMS_RETRY_MS;
    const send = (): void => {
      window.electronAPI.tak.setChatSendRooms(rooms).catch((e: unknown) => {
        if (cancelled) return;
        console.warn('[TakInboundChat] setChatSendRooms failed; retrying ' + errLikeToLogString(e));
        retryTimer = setTimeout(send, delayMs);
        delayMs = Math.min(delayMs * 2, TAK_SEND_ROOMS_RETRY_MAX_MS);
      });
    };
    send();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [sinkActive, roomsKey]);
}
