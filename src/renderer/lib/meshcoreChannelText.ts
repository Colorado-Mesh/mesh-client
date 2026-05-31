import { meshcoreChatStubNodeIdFromDisplayName } from './meshcoreUtils';
import { normalizeReactionEmoji } from './reactions';
import { findParentMessageForReply, truncateReplyPreviewText } from './replyPreview';
import type { ChatMessage, MeshNode } from './types';

export interface MeshcoreNormalizedText {
  senderName?: string;
  payload: string;
  /** Name inside `@[...]` when that prefix was present on the payload (after `Sender: `). */
  bracketTargetName?: string;
  /** True when payload began with `@[…]` even if the name inside brackets was empty (`@[]`). */
  hadBracketReplyPrefix?: boolean;
}

/** Leading reply/tapback marker; name inside brackets may be empty on the wire (`@[] body`). */
const BRACKET_PREFIX = /^@\[([^\]]*)\]\s*(.*)$/su;

/**
 * Parse a leading `@[Name] rest` segment (name may be empty — firmware sometimes sends `@[] body`).
 */
export function parseMeshcoreBracketPrefix(rawText: string): {
  hadBracketPrefix: boolean;
  targetName?: string;
  body: string;
} {
  const t = (rawText ?? '').trim();
  if (!t) return { hadBracketPrefix: false, body: '' };
  const m = BRACKET_PREFIX.exec(t);
  if (!m) return { hadBracketPrefix: false, body: t };
  const targetName = m[1].trim();
  return {
    hadBracketPrefix: true,
    targetName: targetName.length > 0 ? targetName : undefined,
    body: (m[2] ?? '').trim(),
  };
}

/**
 * Parse a full DM body (or any line) for a leading `@[Name] rest` segment.
 */
export function parseMeshcorePlainBracketLine(rawText: string): MeshcoreNormalizedText {
  const parsed = parseMeshcoreBracketPrefix(rawText);
  if (!parsed.hadBracketPrefix) return { payload: parsed.body };
  return {
    hadBracketReplyPrefix: true,
    payload: parsed.body,
    ...(parsed.targetName ? { bracketTargetName: parsed.targetName } : {}),
  };
}

/**
 * Parse MeshCore channel line `DisplayName: payload` and strip `@[Target] ` prefix when present.
 */
export interface MeshcoreChannelSenderResolution {
  senderId: number;
  displayName: string;
  payload: string;
}

/**
 * Resolve channel message sender id + display label from wire text, RF hints, and contacts.
 * Does not assign the shared "Unknown" stub id — unidentified speakers keep senderId 0.
 */
export function resolveMeshcoreChannelMessageSender(opts: {
  rawText: string;
  fromNodeId?: number;
  recordSenderName?: string | null;
  rfFromNodeId?: number | null;
  rfAdvertName?: string | null;
  nodes?: Map<number, MeshNode>;
}): MeshcoreChannelSenderResolution {
  const normalized = normalizeMeshcoreIncomingText(opts.rawText);
  const from = opts.fromNodeId ?? 0;
  let senderId = opts.rfFromNodeId ?? (from !== 0 ? from : 0);
  let displayName =
    opts.recordSenderName?.trim() ||
    normalized.senderName?.trim() ||
    opts.rfAdvertName?.trim() ||
    undefined;
  if (senderId !== 0 && !displayName) {
    const node = opts.nodes?.get(senderId);
    displayName = node?.long_name?.trim() || node?.short_name?.trim() || undefined;
    if (!displayName) {
      displayName = `Node-${senderId.toString(16).toUpperCase()}`;
    }
  }
  if (senderId === 0 && displayName) {
    senderId = meshcoreChatStubNodeIdFromDisplayName(displayName);
  }
  return {
    senderId,
    displayName: displayName || 'Unknown',
    payload: normalized.payload.length > 0 ? normalized.payload : opts.rawText.trim(),
  };
}

export function normalizeMeshcoreIncomingText(rawText: string): MeshcoreNormalizedText {
  const text = (rawText ?? '').trim();
  if (!text) return { payload: '' };
  const colonIdx = text.indexOf(':');
  if (colonIdx <= 0 || text[colonIdx + 1] !== ' ') return { payload: text };
  const senderCandidate = text.slice(0, colonIdx).trim();
  let payload = text.slice(colonIdx + 1).trim();
  if (!senderCandidate || !payload) return { payload: text };
  const bracket = parseMeshcoreBracketPrefix(payload);
  if (bracket.hadBracketPrefix) {
    payload = bracket.body;
    return {
      senderName: senderCandidate,
      payload,
      hadBracketReplyPrefix: true,
      ...(bracket.targetName ? { bracketTargetName: bracket.targetName } : {}),
    };
  }
  return { senderName: senderCandidate, payload };
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

/** Alphanumeric tokens for callsign matching (emoji/punctuation stripped). */
export function meshcoreDisplayNameTokens(name: string): string[] {
  const stripped = name.replace(/\p{Extended_Pictographic}/gu, ' ');
  const tokens: string[] = [];
  for (const part of stripped.toLowerCase().split(/\s+/)) {
    const t = part.replace(/[^a-z0-9]/gi, '');
    if (t.length >= 3) tokens.push(t);
  }
  return tokens;
}

/** Compare bracket `@[Name]` targets to stored `sender_name` (trim, case, callsign tokens). */
export function meshcoreBracketDisplayNamesMatch(target: string, senderName: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const t = norm(target);
  const n = norm(senderName);
  if (!t || !n) return false;
  if (t === n) return true;
  if (t.length >= 4 && (n.includes(t) || t.includes(n))) return true;
  const tTokens = meshcoreDisplayNameTokens(target);
  const nTokens = meshcoreDisplayNameTokens(senderName);
  if (tTokens.length > 0 && nTokens.length > 0) {
    for (const tt of tTokens) {
      for (const nt of nTokens) {
        if (tt === nt || nt.startsWith(tt) || tt.startsWith(nt)) return true;
      }
    }
  }
  return false;
}

function meshcoreBracketUnresolvedReplyFields(
  target: string,
  body: string,
  fallbackPayload: string,
): Pick<ChatMessage, 'payload' | 'replyPreviewSender'> {
  const trimmed = body.trim();
  return {
    payload: trimmed.length > 0 ? trimmed : fallbackPayload,
    replyPreviewSender: target,
  };
}

/** Rebuild wire text for {@link repairMeshcoreDisplayMessages} without duplicating `Sender: `. */
export function meshcoreChannelRepairRawText(msg: ChatMessage): string {
  const p = msg.payload.trim();
  if (/^[^:\n]{1,80}:\s/u.test(p)) return p;
  return `${msg.sender_name}: ${p}`;
}

/** Sort + parse/repair MeshCore chat rows for UI (store, runtime, ChatPanel). */
export function meshcoreChatMessagesForDisplay(messages: readonly ChatMessage[]): ChatMessage[] {
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  return repairMeshcoreDisplayMessages(sorted);
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
    if (!meshcoreBracketDisplayNamesMatch(opts.targetName, m.sender_name)) continue;
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
    if (!meshcoreBracketDisplayNamesMatch(opts.targetName, m.sender_name)) continue;
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
  /** RF path hops from correlated raw packet when known */
  rxHops?: number;
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

  const rxFields =
    opts.rxHops != null && Number.isFinite(opts.rxHops)
      ? ({ rxHops: opts.rxHops } satisfies Pick<ChatMessage, 'rxHops'>)
      : {};

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
    ...rxFields,
  };

  const target = normalized.bracketTargetName;
  if (normalized.hadBracketReplyPrefix && !target) {
    const body = normalized.payload.trim();
    return {
      ...base,
      payload: body.length > 0 ? body : fallbackPayload,
    };
  }
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
    const body = normalized.payload.trim();
    return { ...base, ...meshcoreBracketUnresolvedReplyFields(target, body, fallbackPayload) };
  }

  return {
    ...base,
    payload: normalized.payload.length > 0 ? normalized.payload : fallbackPayload,
  };
}

/**
 * Re-parse stored/live rows that still carry `@[Name]` in payload without `replyId` (e.g. parent
 * was missing at first ingest). Runs in timestamp order so parent resolution can use prior rows.
 */
/** When the wire sends `@[] body`, infer parent as the latest prior message from another sender in-thread. */
function inferMeshcoreEmptyBracketReplyParent(
  prior: readonly ChatMessage[],
  msg: ChatMessage,
): ChatMessage | undefined {
  let best: ChatMessage | undefined;
  for (const m of prior) {
    if (m.channel !== msg.channel) continue;
    if ((m.to ?? undefined) !== (msg.to ?? undefined)) continue;
    if (m.timestamp >= msg.timestamp) continue;
    if (m.sender_id === msg.sender_id) continue;
    if (m.emoji != null && m.replyId != null) continue;
    if (!best || m.timestamp > best.timestamp) best = m;
  }
  return best;
}

function mergeRepairedMeshcoreMessage(existing: ChatMessage, rebuilt: ChatMessage): ChatMessage {
  return {
    ...rebuilt,
    id: existing.id,
    packetId: existing.packetId ?? rebuilt.packetId,
    receivedVia: existing.receivedVia ?? rebuilt.receivedVia,
    isHistory: existing.isHistory ?? rebuilt.isHistory,
    meshcoreDedupeKey: existing.meshcoreDedupeKey ?? rebuilt.meshcoreDedupeKey,
    status: existing.status ?? rebuilt.status,
  };
}

export function repairMeshcoreDisplayMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const prior: ChatMessage[] = [];
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    let next = msg;
    if (msg.emoji != null && msg.replyId != null) {
      prior.push(next);
      out.push(next);
      continue;
    }
    if (msg.replyId != null && !msg.replyPreviewSender && !msg.replyPreviewText) {
      const parent = findParentMessageForReply(prior, msg.replyId);
      if (parent) {
        next = {
          ...msg,
          replyPreviewText: truncateReplyPreviewText(parent.payload),
          replyPreviewSender: parent.sender_name,
        };
      }
    }
    const parsed = parseMeshcorePlainBracketLine(msg.payload.trim());
    if (parsed.hadBracketReplyPrefix && !parsed.bracketTargetName) {
      const body =
        parsed.payload.length > 0
          ? parsed.payload
          : msg.payload.replace(/^@\[\s*\]\s*/u, '').trim();
      const inferred = inferMeshcoreEmptyBracketReplyParent(prior, msg);
      if (inferred) {
        const parentKey = inferred.packetId ?? inferred.timestamp;
        next = {
          ...msg,
          payload: body,
          replyId: parentKey,
          replyPreviewText: truncateReplyPreviewText(inferred.payload),
          replyPreviewSender: inferred.sender_name,
        };
      } else {
        next = { ...msg, payload: body };
      }
    } else if (parsed.bracketTargetName) {
      if (msg.channel === -1 && msg.to != null) {
        next = mergeRepairedMeshcoreMessage(
          msg,
          buildMeshcoreDmIncomingMessage(prior, {
            rawText: msg.payload,
            senderId: msg.sender_id,
            displayName: msg.sender_name,
            timestamp: msg.timestamp,
            receivedVia: msg.receivedVia,
            peerNodeId: msg.sender_id,
            myNodeId: msg.to,
            to: msg.to,
            rxHops: msg.rxHops,
          }),
        );
      } else if (msg.channel >= 0) {
        next = mergeRepairedMeshcoreMessage(
          msg,
          buildMeshcoreChannelIncomingMessage(prior, {
            rawText: meshcoreChannelRepairRawText(msg),
            senderId: msg.sender_id,
            displayName: msg.sender_name,
            channel: msg.channel,
            timestamp: msg.timestamp,
            receivedVia: msg.receivedVia,
            rxHops: msg.rxHops,
          }),
        );
      }
    }
    prior.push(next);
    out.push(next);
  }
  return out;
}

export interface BuildMeshcoreDmIncomingOpts {
  rawText: string;
  senderId: number;
  displayName: string;
  timestamp: number;
  receivedVia: ChatMessage['receivedVia'];
  /** RF path hops from correlated raw packet when known */
  rxHops?: number;
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
  const rxFields =
    opts.rxHops != null && Number.isFinite(opts.rxHops)
      ? ({ rxHops: opts.rxHops } satisfies Pick<ChatMessage, 'rxHops'>)
      : {};

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
    ...rxFields,
  };

  if (parsed.hadBracketReplyPrefix && !parsed.bracketTargetName) {
    const body = parsed.payload.trim();
    return { ...base, payload: body.length > 0 ? body : opts.rawText };
  }
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
    const body = parsed.payload.trim();
    return { ...base, ...meshcoreBracketUnresolvedReplyFields(target, body, opts.rawText) };
  }

  return { ...base, payload: opts.rawText };
}

/** meshcore.js `TxtTypes.SignedPlain` — room server pushed posts. */
export const MESHCORE_TXT_TYPE_SIGNED_PLAIN = 2;

export function parseMeshcoreRoomPostPayload(
  text: string,
  pubKeyPrefixToNodeId: Map<string, number>,
): { authorId: number; payload: string } {
  if (text.length <= 4) {
    return { authorId: 0, payload: text };
  }
  const prefix = Array.from(text.slice(0, 4))
    .map((c) => (c.charCodeAt(0) & 0xff).toString(16).padStart(2, '0'))
    .join('');
  const authorId = pubKeyPrefixToNodeId.get(prefix) ?? 0;
  return { authorId, payload: text.slice(4) };
}

/** Build SignedPlain room post wire text (4-byte author pubkey prefix + body). */
export function formatMeshcoreRoomPostWireText(authorPubKey: Uint8Array, text: string): string {
  if (authorPubKey.length < 4) {
    throw new Error('Room post requires at least 4 bytes of author public key');
  }
  const prefix = String.fromCharCode(
    authorPubKey[0] & 0xff,
    authorPubKey[1] & 0xff,
    authorPubKey[2] & 0xff,
    authorPubKey[3] & 0xff,
  );
  return prefix + text;
}

export interface BuildMeshcoreRoomIncomingOpts {
  rawText: string;
  roomServerId: number;
  authorId: number;
  authorName: string;
  timestamp: number;
  receivedVia: ChatMessage['receivedVia'];
  rxHops?: number;
}

export function buildMeshcoreRoomIncomingMessage(opts: BuildMeshcoreRoomIncomingOpts): ChatMessage {
  const rxFields =
    opts.rxHops != null && Number.isFinite(opts.rxHops)
      ? ({ rxHops: opts.rxHops } satisfies Pick<ChatMessage, 'rxHops'>)
      : {};
  return {
    sender_id: opts.authorId,
    sender_name: opts.authorName,
    payload: opts.rawText,
    channel: -2,
    timestamp: opts.timestamp,
    status: 'acked',
    receivedVia: opts.receivedVia,
    roomServerId: opts.roomServerId,
    to: opts.roomServerId,
    meshcoreDedupeKey: opts.rawText,
    ...rxFields,
  };
}
