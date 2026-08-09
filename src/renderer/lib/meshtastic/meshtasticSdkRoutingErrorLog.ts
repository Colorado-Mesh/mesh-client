import i18n from '@/renderer/lib/i18n';
import { meshtasticPacketIdsEqual } from '@/renderer/lib/meshtasticMessageDedup';
import { resolveMeshtasticOutboundStoreKey } from '@/renderer/lib/sessions/meshtasticSession';
import { messageRecordsToChatMessages } from '@/renderer/lib/storeRecordAdapters';
import type { ChatMessage } from '@/renderer/lib/types';
import { updateMessageStatus, useMessageStore } from '@/renderer/stores/messageStore';

import { meshtasticRoutingErrorName } from './meshtasticApplyErrorMessage';
import {
  hasMeshtasticNonChatOutboundInFlight,
  isMeshtasticNonChatWirePacketId,
} from './meshtasticOutboundCoordination';

const SDK_ROUTING_ERROR_RE = /Error received for packet (\d+): ([A-Z0-9_]+)/;
const SDK_PACKET_TIMEOUT_RE = /Packet (\d+) of type \w+ timed out/;
const FALLBACK_SENDING_WINDOW_MS = 90_000;
const routingErrorScansInFlight = new Set<string>();

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

/**
 * True for routing errors that mean we lack a usable public key for the DM recipient.
 * Requesting the recipient's NODEINFO can recover the key so a retry succeeds.
 */
export function isMeshtasticMissingRecipientKeyError(errorName: string): boolean {
  return errorName === 'PKI_SEND_FAIL_PUBLIC_KEY' || errorName === 'PKI_UNKNOWN_PUBKEY';
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
    case 'RATE_LIMIT_EXCEEDED':
      return 'chatPanel.routingErrors.rateLimited';
    case 'NO_INTERFACE':
    case 'NO_INTERFACE_AVAILABLE':
      return 'chatPanel.routingErrors.noInterface';
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
  /** Identity whose `messageStore` bucket holds the outbound row. */
  identityId: string | null;
  /** tempId → wire packet id assigned by the SDK (may differ from optimistic id). */
  tempIdToWirePacketId?: ReadonlyMap<number, number>;
  /** Invoked with the recipient node num when a DM fails for lack of that node's public key. */
  onMissingRecipientKey?: (recipientNodeNum: number) => void;
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

function storeOutboundMessagesAsChat(identityId: string, myNodeNum: number): ChatMessage[] {
  const records = Object.values(useMessageStore.getState().messages[identityId] ?? {}).filter(
    (r) => r.from === myNodeNum,
  );
  return messageRecordsToChatMessages(records);
}

function findOutboundTargetForWirePacketId(
  wirePacketId: number,
  ctx: ApplyMeshtasticOutboundRoutingErrorContext,
): ChatMessage | undefined {
  const { myNodeNum, identityId, tempIdToWirePacketId } = ctx;
  if (!identityId) return undefined;

  const messages = storeOutboundMessagesAsChat(identityId, myNodeNum);
  const matched = messages.find((m) =>
    outboundMatchesWirePacketId(m, myNodeNum, wirePacketId, tempIdToWirePacketId),
  );
  if (matched) return matched;

  // An unmatched wire id may belong to a non-chat wantAck packet (e.g. the
  // share-location Waypoint) — do not misattribute its NAK to a pending chat row.
  if (hasMeshtasticNonChatOutboundInFlight()) return undefined;

  return findFallbackSendingOutbound(messages, myNodeNum);
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
  const { identityId } = ctx;
  // Known non-chat packet (e.g. share-location Waypoint): its NAK must never be
  // applied to a chat row — the same log line is re-applied asynchronously via
  // the main-process log echo after the in-flight window closes.
  if (isMeshtasticNonChatWirePacketId(parsed.packetId)) {
    return false;
  }
  const target = findOutboundTargetForWirePacketId(parsed.packetId, ctx);
  if (!target || !identityId) {
    return false;
  }
  const storeMessageId = resolveStoreMessageId(target, parsed.packetId);
  updateMessageStatus(identityId, storeMessageId, 'failed', errorText);
  // Missing recipient public key: fetch the recipient's NODEINFO so a retry can succeed.
  if (isMeshtasticMissingRecipientKeyError(parsed.errorName) && target.to != null) {
    ctx.onMissingRecipientKey?.(target.to);
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
  const key = `${ctx.identityId ?? 'none'}:${parsed.packetId}:${parsed.errorName}`;
  if (routingErrorScansInFlight.has(key)) {
    return false;
  }
  routingErrorScansInFlight.add(key);
  queueMicrotask(() => routingErrorScansInFlight.delete(key));
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
