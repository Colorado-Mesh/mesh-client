import { meshcoreMessageMatchesReplyKey } from './meshcoreChannelText';
import type { ChatMessage } from './types';

/** MM-PLAN Feature 2: truncated original message text (max 50 chars). */
export const REPLY_PREVIEW_MAX_LEN = 50;

export function truncateReplyPreviewText(payload: string): string {
  return payload.length > REPLY_PREVIEW_MAX_LEN
    ? payload.slice(0, REPLY_PREVIEW_MAX_LEN) + '…'
    : payload;
}

export interface MeshtasticReplyLookupOptions {
  replyPreviewSender?: string;
  beforeTimestamp?: number;
  channel?: number;
  to?: number;
  /** Reply author; used to break global packet-id collisions across nodes. */
  excludeSenderId?: number;
}

function normalizeReplySenderLabel(label: string | undefined): string {
  return (label ?? '').trim().toLowerCase();
}

function senderLabelsMatch(message: ChatMessage, replyPreviewSender: string): boolean {
  const target = normalizeReplySenderLabel(replyPreviewSender);
  if (!target) return false;
  const candidate = normalizeReplySenderLabel(message.sender_name);
  return candidate === target || candidate.includes(target) || target.includes(candidate);
}

function meshtasticThreadMatches(
  message: ChatMessage,
  opts?: Pick<MeshtasticReplyLookupOptions, 'channel' | 'to'>,
): boolean {
  if (opts?.channel != null && message.channel !== opts.channel) return false;
  if (opts?.to != null) {
    return message.to === opts.to || message.sender_id === opts.to;
  }
  if (opts?.channel != null && message.to != null) return false;
  return true;
}

function filterMeshtasticThreadMatches(
  matches: readonly ChatMessage[],
  opts?: MeshtasticReplyLookupOptions,
): ChatMessage[] {
  if (opts?.channel == null && opts?.to == null) return [...matches];
  const threaded = matches.filter((m) => meshtasticThreadMatches(m, opts));
  return threaded.length > 0 ? threaded : [...matches];
}

function disambiguateMeshtasticReplyMatches(
  matches: readonly ChatMessage[],
  opts?: MeshtasticReplyLookupOptions,
): ChatMessage | undefined {
  if (matches.length === 0) return undefined;

  const chronologyFiltered =
    opts?.beforeTimestamp != null
      ? matches.filter((m) => m.timestamp <= opts.beforeTimestamp!)
      : [...matches];
  if (chronologyFiltered.length === 0) return undefined;
  if (chronologyFiltered.length === 1) return chronologyFiltered[0];

  if (opts?.replyPreviewSender) {
    const bySender = chronologyFiltered.filter((m) =>
      senderLabelsMatch(m, opts.replyPreviewSender!),
    );
    if (bySender.length === 1) return bySender[0];
    if (bySender.length > 1) {
      return pickLatestMeshtasticReplyMatch(bySender);
    }
  }

  return pickLatestMeshtasticReplyMatch(chronologyFiltered);
}

function pickLatestMeshtasticReplyMatch(matches: readonly ChatMessage[]): ChatMessage | undefined {
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1];
}

/**
 * Meshtastic wire `reply_id` is the parent MeshPacket id (uint32, per-sender counter).
 * Lookup is packet-id only — no timestamp fallbacks (they collide with unrelated ids).
 */
export function findMeshtasticParentMessageForReply(
  messages: readonly ChatMessage[],
  replyId: number,
  opts?: MeshtasticReplyLookupOptions,
): ChatMessage | undefined {
  let packetMatches = filterMeshtasticThreadMatches(
    messages.filter((m) => m.packetId === replyId),
    opts,
  );
  if (opts?.excludeSenderId != null && packetMatches.length > 1) {
    const withoutReplyAuthor = packetMatches.filter((m) => m.sender_id !== opts.excludeSenderId);
    if (withoutReplyAuthor.length > 0) packetMatches = withoutReplyAuthor;
  }
  const parent = disambiguateMeshtasticReplyMatches(packetMatches, opts);
  return parent;
}

/** Resolve UI reply key to the RF packet id on the wire (must match a known parent packet id). */
export function resolveMeshtasticWireReplyId(
  messages: readonly ChatMessage[],
  replyKey: number,
): number | undefined {
  const byPacket = messages.find((m) => m.packetId === replyKey);
  if (byPacket?.packetId != null && byPacket.packetId !== 0) return byPacket.packetId;
  return undefined;
}

/** Re-derive reply preview fields from the loaded thread (fixes stale DB previews). */
export function repairMeshtasticReplyPreviews(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (msg.replyId == null || msg.emoji != null) return msg;
    const parent = findMeshtasticParentMessageForReply(messages, msg.replyId, {
      replyPreviewSender: msg.replyPreviewSender,
      beforeTimestamp: msg.timestamp,
      channel: msg.channel,
      to: msg.to,
      excludeSenderId: msg.sender_id,
    });
    if (!parent) {
      if (msg.replyPreviewText == null && msg.replyPreviewSender == null) return msg;
      return { ...msg, replyPreviewText: undefined, replyPreviewSender: undefined };
    }
    const preview = truncateReplyPreviewText(parent.payload);
    const sender =
      parent.sender_name != null && parent.sender_name.trim() !== ''
        ? parent.sender_name
        : msg.replyPreviewSender;
    if (msg.replyPreviewText === preview && msg.replyPreviewSender === sender) return msg;
    return { ...msg, replyPreviewText: preview, replyPreviewSender: sender };
  });
}

/** MeshCore reply lookup: packetId first, timestamp fallback, sec↔ms normalization. */
export function findParentMessageForReply(
  messages: readonly ChatMessage[],
  replyId: number,
): ChatMessage | undefined {
  return messages.find((m) => meshcoreMessageMatchesReplyKey(m, replyId));
}

/**
 * Fills reply preview fields when the parent message is present in `priorMessages`
 * (Meshtastic RF/MQTT ingest).
 */
export function enrichMeshtasticReplyPreviews(
  msg: ChatMessage,
  priorMessages: readonly ChatMessage[],
  resolveSenderLabel: (senderId: number) => string,
): ChatMessage {
  if (msg.replyId == null) return msg;
  const parent = findMeshtasticParentMessageForReply(priorMessages, msg.replyId, {
    replyPreviewSender: msg.replyPreviewSender,
    beforeTimestamp: msg.timestamp,
    channel: msg.channel,
    to: msg.to,
    excludeSenderId: msg.sender_id,
  });
  if (!parent) return msg;
  const label =
    parent.sender_name != null && parent.sender_name.trim() !== ''
      ? parent.sender_name
      : resolveSenderLabel(parent.sender_id);
  return {
    ...msg,
    replyPreviewText: truncateReplyPreviewText(parent.payload),
    replyPreviewSender: label,
  };
}
