import { useEffect, useRef } from 'react';

import { isBotReplyText } from '../lib/firmwareBotReplyParse';
import type { ChatMessage, MeshProtocol } from '../lib/types';
import { useBotSendersStore } from '../stores/botSendersStore';

const PROTOCOLS: readonly MeshProtocol[] = ['meshtastic', 'meshcore', 'reticulum'];

function messageScanKey(m: ChatMessage): string {
  return `${m.storeId ?? m.id ?? ''}:${m.timestamp}:${m.sender_id}`;
}

/**
 * Scan newly arrived messages (newest first, stopping at the first already-seen key) and
 * mark senders whose text matches a known bot reply template. Pure for unit tests.
 */
export function scanForBotSenders(
  messages: readonly ChatMessage[],
  seen: Set<string>,
  selfNodeId: number | null | undefined,
  onBot: (senderId: number) => void,
): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const key = messageScanKey(m);
    if (seen.has(key)) break;
    seen.add(key);
    if (m.sender_id <= 0 || m.sender_id === selfNodeId) continue;
    if (isBotReplyText(m.payload)) onBot(m.sender_id);
  }
}

/** Mount once from App: feeds `botSendersStore` from every protocol's message list. */
export function useBotSenderDetection(
  messagesByProtocol: Readonly<Record<MeshProtocol, readonly ChatMessage[]>>,
  selfNodeIdByProtocol: Readonly<Record<MeshProtocol, number | null | undefined>>,
): void {
  const seenRef = useRef<Record<MeshProtocol, Set<string>> | null>(null);
  seenRef.current ??= { meshtastic: new Set(), meshcore: new Set(), reticulum: new Set() };

  useEffect(() => {
    const seen = seenRef.current;
    if (!seen) return;
    const { markBotSender } = useBotSendersStore.getState();
    for (const protocol of PROTOCOLS) {
      scanForBotSenders(
        messagesByProtocol[protocol],
        seen[protocol],
        selfNodeIdByProtocol[protocol],
        (senderId) => {
          markBotSender(protocol, senderId);
        },
      );
    }
  }, [messagesByProtocol, selfNodeIdByProtocol]);
}
