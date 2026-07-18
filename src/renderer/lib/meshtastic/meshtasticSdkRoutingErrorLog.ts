import type { Dispatch, RefObject, SetStateAction } from 'react';

import i18n from '@/renderer/lib/i18n';
import { meshtasticPacketIdsEqual } from '@/renderer/lib/meshtasticMessageDedup';
import { resolveMeshtasticOutboundStoreKey } from '@/renderer/lib/sessions/meshtasticSession';
import { messageRecordsToChatMessages } from '@/renderer/lib/storeRecordAdapters';
import type { ChatMessage } from '@/renderer/lib/types';
import { updateMessageStatus, useMessageStore } from '@/renderer/stores/messageStore';

import { meshtasticRoutingErrorName } from './meshtasticApplyErrorMessage';

const SDK_ROUTING_ERROR_RE = /Error received for packet (\d+): ([A-Z0-9_]+)/;
const SDK_PACKET_TIMEOUT_RE = /Packet (\d+) of type \w+ timed out/;
const FALLBACK_SENDING_WINDOW_MS = 90_000;

export interface MeshtasticSdkRoutingErrorLog {
  packetId: number;
  errorName: string;
}

export function parseMeshtasticSdkRoutingErrorLog(
  message: string,
): MeshtasticSdkRoutingErrorLog | null {
  const errorMatch = SDK_ROUTING_ERROR_RE.exec(message);
  if (errorMatch) {
    return {
      packetId: Number(errorMatch[1]),
      errorName: errorMatch[2],
    };
  }
  const timeoutMatch = SDK_PACKET_TIMEOUT_RE.exec(message);
  if (timeoutMatch) {
    return {
      packetId: Number(timeoutMatch[1]),
      errorName: 'TIMEOUT',
    };
  }
  return null;
}

/** Parse `@meshtastic/core` queue.js rejections: `{ id, error }` or `{ packetId, error }`. */
export function parseMeshtasticSdkQueueRejection(
  reason: unknown,
): MeshtasticSdkRoutingErrorLog | null {
  if (typeof reason !== 'object' || reason === null) return null;
  const r = reason as { id?: unknown; packetId?: unknown; error?: unknown };
  if (typeof r.error !== 'number') return null;
  const wireId =
    typeof r.id === 'number' ? r.id : typeof r.packetId === 'number' ? r.packetId : null;
  if (wireId == null) return null;
  return {
    packetId: wireId,
    errorName: meshtasticRoutingErrorName(r.error),
  };
}

/**
 * Human-readable text for an SDK queue rejection (`{ id|packetId, error: number }`).
 * Falls back to the routing error name (e.g. `RATE_LIMIT_EXCEEDED`) when no chat
 * i18n mapping exists; returns null when `reason` is not a queue rejection.
 */
export function humanizeMeshtasticSdkQueueRejectionError(reason: unknown): string | null {
  const parsed = parseMeshtasticSdkQueueRejection(reason);
  if (!parsed) return null;
  const i18nKey = chatRoutingErrorKeyForSdkErrorName(parsed.errorName);
  return i18nKey ? i18n.t(i18nKey) : parsed.errorName;
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
  /** tempId → wire packet id assigned by the SDK (may differ from optimistic id). */
  tempIdToWirePacketId?: ReadonlyMap<number, number>;
}

function outboundMatchesWirePacketId(
  msg: ChatMessage,
  myNodeNum: number,
  wirePacketId: number,
  tempIdToWirePacketId?: ReadonlyMap<number, number>,
): boolean {
  if (myNodeNum <= 0 || msg.sender_id !== myNodeNum || msg.packetId == null) {
    return false;
  }
  if (meshtasticPacketIdsEqual(msg.packetId, wirePacketId)) {
    return true;
  }
  if (tempIdToWirePacketId) {
    const mapped = tempIdToWirePacketId.get(msg.packetId >>> 0);
    if (mapped != null && meshtasticPacketIdsEqual(mapped, wirePacketId)) {
      return true;
    }
  }
  return false;
}

function findFallbackSendingOutbound(
  messages: readonly ChatMessage[],
  myNodeNum: number,
): ChatMessage | undefined {
  const cutoff = Date.now() - FALLBACK_SENDING_WINDOW_MS;
  const candidates = messages.filter(
    (m) =>
      m.sender_id === myNodeNum &&
      m.status === 'sending' &&
      m.timestamp >= cutoff &&
      m.packetId != null,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function findOutboundTargetForWirePacketId(
  wirePacketId: number,
  ctx: ApplyMeshtasticOutboundRoutingErrorContext,
): ChatMessage | undefined {
  const { myNodeNum, messagesRef, identityId, tempIdToWirePacketId } = ctx;
  const fromLegacy = messagesRef.current.find((m) =>
    outboundMatchesWirePacketId(m, myNodeNum, wirePacketId, tempIdToWirePacketId),
  );
  if (fromLegacy) return fromLegacy;

  if (identityId) {
    const storeMsgs = messageRecordsToChatMessages(
      Object.values(useMessageStore.getState().messages[identityId] ?? {}),
    );
    const fromStore = storeMsgs.find((m) =>
      outboundMatchesWirePacketId(m, myNodeNum, wirePacketId, tempIdToWirePacketId),
    );
    if (fromStore) return fromStore;
  }

  return findFallbackSendingOutbound(messagesRef.current, myNodeNum);
}

function messageMatchesTarget(
  msg: ChatMessage,
  target: ChatMessage,
  myNodeNum: number,
  wirePacketId: number,
  tempIdToWirePacketId?: ReadonlyMap<number, number>,
): boolean {
  if (msg === target) return true;
  if (target.packetId == null) return false;
  return outboundMatchesWirePacketId(msg, myNodeNum, wirePacketId, tempIdToWirePacketId);
}

function resolveStoreMessageId(target: ChatMessage, wirePacketId: number): string {
  const packetId = target.packetId ?? wirePacketId;
  return resolveMeshtasticOutboundStoreKey(packetId >>> 0, String(packetId));
}

/** Apply parsed SDK routing error to outbound chat rows (async post-send failures). */
export function applyMeshtasticOutboundRoutingError(
  parsed: MeshtasticSdkRoutingErrorLog,
  ctx: ApplyMeshtasticOutboundRoutingErrorContext,
): boolean {
  const i18nKey = chatRoutingErrorKeyForSdkErrorName(parsed.errorName);
  if (!i18nKey) {
    return false;
  }
  const errorText = i18n.t(i18nKey);
  const { myNodeNum, identityId, setMessages, tempIdToWirePacketId } = ctx;
  const target = findOutboundTargetForWirePacketId(parsed.packetId, ctx);
  if (!target) {
    return false;
  }
  const storeMessageId = resolveStoreMessageId(target, parsed.packetId);
  const matches = (m: ChatMessage) =>
    messageMatchesTarget(m, target, myNodeNum, parsed.packetId, tempIdToWirePacketId);

  setMessages((prev) =>
    prev.map((m) =>
      matches(m)
        ? { ...m, status: 'failed' as const, error: errorText, packetId: parsed.packetId }
        : m,
    ),
  );
  if (identityId) {
    updateMessageStatus(identityId, storeMessageId, 'failed', errorText);
  }
  // The DB row may still hold the optimistic temp packet id (device never acked,
  // so updateMessagePacketId never ran) — key the update on the row's own id,
  // not the wire id from the radio NAK, or the UPDATE matches zero rows.
  const dbPacketId = target.packetId ?? parsed.packetId;
  void window.electronAPI.db
    .updateMessageStatus(dbPacketId, 'failed', errorText)
    .catch((err: unknown) => {
      console.debug(
        '[meshtasticSdkRoutingErrorLog] DB update failed',
        err instanceof Error ? err.message : String(err),
      );
    });
  return true;
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
  return applyMeshtasticOutboundRoutingError(parsed, ctx);
}

/** Apply SDK queue promise rejections (`queue.js` timeout / routing errors). */
export function applyMeshtasticOutboundRoutingErrorFromRejection(
  reason: unknown,
  ctx: ApplyMeshtasticOutboundRoutingErrorContext,
): boolean {
  const parsed = parseMeshtasticSdkQueueRejection(reason);
  if (!parsed) {
    return false;
  }
  return applyMeshtasticOutboundRoutingError(parsed, ctx);
}
