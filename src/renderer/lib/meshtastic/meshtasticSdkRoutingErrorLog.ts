import type { Dispatch, RefObject, SetStateAction } from 'react';

import i18n from '@/renderer/lib/i18n';
import { meshtasticPacketIdsEqual } from '@/renderer/lib/meshtasticMessageDedup';
import type { ChatMessage } from '@/renderer/lib/types';
import { updateMessageStatus } from '@/renderer/stores/messageStore';

const SDK_ROUTING_ERROR_RE = /Error received for packet (\d+): ([A-Z0-9_]+)/;

export interface MeshtasticSdkRoutingErrorLog {
  packetId: number;
  errorName: string;
}

export function parseMeshtasticSdkRoutingErrorLog(
  message: string,
): MeshtasticSdkRoutingErrorLog | null {
  const match = SDK_ROUTING_ERROR_RE.exec(message);
  if (!match) {
    return null;
  }
  return {
    packetId: Number(match[1]),
    errorName: match[2],
  };
}

export function chatRoutingErrorKeyForSdkErrorName(errorName: string): string | null {
  switch (errorName) {
    case 'PKI_SEND_FAIL_PUBLIC_KEY':
      return 'chatPanel.routingErrors.pkiMissingRecipientKey';
    case 'PKI_FAILED':
    case 'PKI_UNKNOWN_PUBKEY':
      return 'chatPanel.routingErrors.pkiFailed';
    case 'NO_CHANNEL':
      return 'chatPanel.routingErrors.noChannel';
    case 'TIMEOUT':
    case 'NO_RESPONSE':
    case 'MAX_RETRANSMIT':
      return 'chatPanel.routingErrors.timeout';
    default:
      return null;
  }
}

export interface ApplyMeshtasticOutboundRoutingErrorContext {
  myNodeNum: number;
  identityId: string | null;
  messagesRef: RefObject<ChatMessage[]>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

function isSelfOutboundMessage(msg: ChatMessage, myNodeNum: number, packetId: number): boolean {
  if (myNodeNum <= 0 || msg.sender_id !== myNodeNum) {
    return false;
  }
  return msg.packetId != null && meshtasticPacketIdsEqual(msg.packetId, packetId);
}

/** Apply SDK console routing errors to outbound chat rows (async post-send failures). */
export function applyMeshtasticOutboundRoutingErrorFromLog(
  message: string,
  ctx: ApplyMeshtasticOutboundRoutingErrorContext,
): boolean {
  const parsed = parseMeshtasticSdkRoutingErrorLog(message);
  if (!parsed) {
    return false;
  }
  const i18nKey = chatRoutingErrorKeyForSdkErrorName(parsed.errorName);
  if (!i18nKey) {
    return false;
  }
  const errorText = i18n.t(i18nKey);
  const { myNodeNum, identityId, messagesRef, setMessages } = ctx;
  const target = messagesRef.current.find((m) =>
    isSelfOutboundMessage(m, myNodeNum, parsed.packetId),
  );
  if (!target) {
    return false;
  }
  const storeMessageId = String(target.packetId ?? parsed.packetId);
  setMessages((prev) =>
    prev.map((m) =>
      isSelfOutboundMessage(m, myNodeNum, parsed.packetId)
        ? { ...m, status: 'failed' as const, error: errorText }
        : m,
    ),
  );
  if (identityId) {
    updateMessageStatus(identityId, storeMessageId, 'failed', errorText);
  }
  void window.electronAPI.db
    .updateMessageStatus(parsed.packetId, 'failed', errorText)
    .catch((err: unknown) => {
      console.debug(
        '[meshtasticSdkRoutingErrorLog] DB update failed',
        err instanceof Error ? err.message : String(err),
      );
    });
  return true;
}
