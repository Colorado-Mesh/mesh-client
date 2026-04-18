import { normalizeReactionEmoji } from './reactions';
import { findParentMessageForReply, truncateReplyPreviewText } from './replyPreview';
import type { ChatMessage } from './types';

export interface MeshcoreNormalizedText {
  senderName?: string;
  payload: string;
  /** Name inside `@[...]` when that prefix was present on the payload (after `Sender: `). */
  bracketTargetName?: string;
}

const BRACKET_PAYLOAD = /^@\[([^\]]+)\]\s*(.*)$/su;

/** DM / plain-text tapback lines are the full body `@[TargetName] …` (no `Sender: ` prefix). */
const PLAIN_BRACKET_LINE = /^@\[([^\]]+)\]\s*(.*)$/su;

/**
 * Parse a full DM body (or any line) for a leading `@[Name] rest` segment.
 */
export function parseMeshcorePlainBracketLine(rawText: string): MeshcoreNormalizedText {
  const t = (rawText ?? '').trim();
  if (!t) return { payload: '' };
  const m = PLAIN_BRACKET_LINE.exec(t);
  if (!m) return { payload: t };
  return {
    bracketTargetName: m[1].trim(),
    payload: (m[2] ?? '').trim(),
  };
}

/**
 * Parse MeshCore channel line `DisplayName: payload` and strip `@[Target] ` prefix when present.
 */
export function normalizeMeshcoreIncomingText(rawText: string): MeshcoreNormalizedText {
  const text = (rawText ?? '').trim();
  if (!text) return { payload: '' };
  const colonIdx = text.indexOf(':');
  if (colonIdx <= 0) return { payload: text };
  const senderCandidate = text.slice(0, colonIdx).trim();
  let payload = text.slice(colonIdx + 1).trim();
  if (!senderCandidate || !payload) return { payload: text };
  const m = BRACKET_PAYLOAD.exec(payload);
  let bracketTargetName: string | undefined;
  if (m) {
    bracketTargetName = m[1].trim();
    payload = (m[2] ?? '').trim();
  }
  return { senderName: senderCandidate, payload, bracketTargetName };
}

/** True when `payload` is a single grapheme cluster and normalizes as a reaction emoji. */
export function meshcorePayloadIsTapbackEmojiOnly(payload: string): boolean {
  const t = payload.trim();
  if (!t || /\s/.test(t)) return false;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const segments = [...seg.segment(t)];
    if (segments.length !== 1) return false;
  } else if (t.length > 8) {
    return false;
  }
  return normalizeReactionEmoji(undefined, t) !== undefined;
}

export interface MeshcoreParentResolveOpts {
  channel: number;
  targetName: string;
  beforeTimestamp: number;
  /** DM thread: both sides must match `to` (undefined = broadcast channel). */
  to: number | undefined;
}

/**
 * Latest message in the same thread whose `sender_name` matches `targetName` and is strictly older than `beforeTimestamp`.
 */
export function resolveMeshcoreBracketParentKey(
  messages: readonly ChatMessage[],
  opts: MeshcoreParentResolveOpts,
): number | undefined {
  let best: ChatMessage | undefined;
  for (const m of messages) {
    if (m.channel !== opts.channel) continue;
    if ((m.to ?? undefined) !== (opts.to ?? undefined)) continue;
    if (m.emoji != null && m.replyId != null) continue;
    if (m.timestamp >= opts.beforeTimestamp) continue;
    if (m.sender_name !== opts.targetName) continue;
    if (!best || m.timestamp > best.timestamp) best = m;
  }
  if (!best) return undefined;
  return best.packetId ?? best.timestamp;
}

/**
 * Resolve `replyId` for `@[DisplayName]` in a DM thread (channel -1). Thread = messages between
 * `peerNodeId` and `myNodeId` (either direction).
 */
export function resolveMeshcoreBracketParentKeyDm(
  messages: readonly ChatMessage[],
  opts: {
    peerNodeId: number;
    myNodeId: number;
    targetName: string;
    beforeTimestamp: number;
  },
): number | undefined {
  let best: ChatMessage | undefined;
  for (const m of messages) {
    if (m.channel !== -1) continue;
    const inThread =
      (m.sender_id === opts.peerNodeId && m.to === opts.myNodeId) ||
      (m.sender_id === opts.myNodeId && m.to === opts.peerNodeId);
    if (!inThread) continue;
    if (m.emoji != null && m.replyId != null) continue;
    if (m.timestamp >= opts.beforeTimestamp) continue;
    if (m.sender_name !== opts.targetName) continue;
    if (!best || m.timestamp > best.timestamp) best = m;
  }
  if (!best) return undefined;
  return best.packetId ?? best.timestamp;
}

/**
 * Find the DM thread message referenced by `replyKey` (`packetId` or `timestamp`) when sending
 * a reply. Excludes reaction rows (`emoji` + `replyId` both set).
 */
export function findMeshcoreDmReplyParent(
  messages: readonly ChatMessage[],
  opts: {
    peerNodeId: number;
    myNodeId: number;
    replyKey: number;
  },
): ChatMessage | undefined {
  return messages.find((m) => {
    const inDmThread =
      (m.sender_id === opts.peerNodeId && m.to === opts.myNodeId) ||
      (m.sender_id === opts.myNodeId && m.to === opts.peerNodeId);
    return (
      inDmThread &&
      (m.packetId === opts.replyKey || m.timestamp === opts.replyKey) &&
      !(m.emoji != null && m.replyId != null)
    );
  });
}

export interface BuildMeshcoreChannelIncomingOpts {
  rawText: string;
  senderId: number;
  displayName: string;
  channel: number;
  timestamp: number;
  receivedVia: ChatMessage['receivedVia'];
}

/**
 * Build a channel `ChatMessage` from raw RF/MQTT text: tap-backs, text replies (`@[Parent] body`),
 * or plain payloads. Uses `messages` only to resolve `replyId` for bracketed lines.
 */
export function buildMeshcoreChannelIncomingMessage(
  messages: readonly ChatMessage[],
  opts: BuildMeshcoreChannelIncomingOpts,
): ChatMessage {
  const normalized = normalizeMeshcoreIncomingText(opts.rawText);
  const colonIdx = opts.rawText.indexOf(':');
  const fallbackPayload =
    colonIdx > 0 ? opts.rawText.slice(colonIdx + 1).trim() : opts.rawText.trim();

  const base: Pick<
    ChatMessage,
    'sender_id' | 'sender_name' | 'channel' | 'timestamp' | 'status' | 'receivedVia'
  > & { meshcoreDedupeKey: string } = {
    sender_id: opts.senderId,
    sender_name: opts.displayName,
    channel: opts.channel,
    timestamp: opts.timestamp,
    status: 'acked',
    receivedVia: opts.receivedVia,
    meshcoreDedupeKey: opts.rawText,
  };

  const target = normalized.bracketTargetName;
  if (target) {
    const parentKey = resolveMeshcoreBracketParentKey(messages, {
      channel: opts.channel,
      targetName: target,
      beforeTimestamp: opts.timestamp,
      to: undefined,
    });
    if (parentKey != null) {
      const body = normalized.payload.trim();
      const parent = findParentMessageForReply(messages, parentKey);
      const previewFields = parent
        ? {
            replyPreviewText: truncateReplyPreviewText(parent.payload),
            replyPreviewSender: parent.sender_name,
          }
        : undefined;
      if (meshcorePayloadIsTapbackEmojiOnly(body)) {
        const emoji = normalizeReactionEmoji(undefined, body);
        if (emoji != null) {
          return { ...base, payload: body, emoji, replyId: parentKey, ...previewFields };
        }
      }
      if (body.length > 0) {
        return { ...base, payload: body, replyId: parentKey, ...previewFields };
      }
    }
    return { ...base, payload: fallbackPayload };
  }

  return {
    ...base,
    payload: normalized.payload.length > 0 ? normalized.payload : fallbackPayload,
  };
}

export interface BuildMeshcoreDmIncomingOpts {
  rawText: string;
  senderId: number;
  displayName: string;
  timestamp: number;
  receivedVia: ChatMessage['receivedVia'];
  /** The other party in this DM (remote contact when receiving their message). */
  peerNodeId: number;
  myNodeId: number;
  to: number | undefined;
}

/**
 * Build a DM `ChatMessage` from raw text: tapbacks `@[Name] emoji`, text replies `@[Name] body`,
 * or plain payload (no leading bracket line).
 */
export function buildMeshcoreDmIncomingMessage(
  messages: readonly ChatMessage[],
  opts: BuildMeshcoreDmIncomingOpts,
): ChatMessage {
  const parsed = parseMeshcorePlainBracketLine(opts.rawText);
  const base: Pick<
    ChatMessage,
    'sender_id' | 'sender_name' | 'channel' | 'timestamp' | 'status' | 'receivedVia' | 'to'
  > & { meshcoreDedupeKey: string } = {
    sender_id: opts.senderId,
    sender_name: opts.displayName,
    channel: -1,
    timestamp: opts.timestamp,
    status: 'acked',
    receivedVia: opts.receivedVia,
    to: opts.to,
    meshcoreDedupeKey: opts.rawText,
  };

  const target = parsed.bracketTargetName;
  if (target) {
    const parentKey = resolveMeshcoreBracketParentKeyDm(messages, {
      peerNodeId: opts.peerNodeId,
      myNodeId: opts.myNodeId,
      targetName: target,
      beforeTimestamp: opts.timestamp,
    });
    if (parentKey != null) {
      const body = parsed.payload.trim();
      const parent = findParentMessageForReply(messages, parentKey);
      const previewFields = parent
        ? {
            replyPreviewText: truncateReplyPreviewText(parent.payload),
            replyPreviewSender: parent.sender_name,
          }
        : undefined;
      if (meshcorePayloadIsTapbackEmojiOnly(body)) {
        const emoji = normalizeReactionEmoji(undefined, body);
        if (emoji != null) {
          return { ...base, payload: body, emoji, replyId: parentKey, ...previewFields };
        }
      }
      if (body.length > 0) {
        return { ...base, payload: body, replyId: parentKey, ...previewFields };
      }
    }
  }

  return { ...base, payload: opts.rawText };
}
