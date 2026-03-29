import { normalizeReactionEmoji } from './reactions';
import type { ChatMessage } from './types';

export interface MeshcoreNormalizedText {
  senderName?: string;
  payload: string;
  /** Name inside `@[...]` when that prefix was present on the payload (after `Sender: `). */
  bracketTargetName?: string;
}

const BRACKET_PAYLOAD = /^@\[([^\]]+)\]\s*(.*)$/su;

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
      if (meshcorePayloadIsTapbackEmojiOnly(body)) {
        const emoji = normalizeReactionEmoji(undefined, body);
        if (emoji != null) {
          return { ...base, payload: body, emoji, replyId: parentKey };
        }
      }
      if (body.length > 0) {
        return { ...base, payload: body, replyId: parentKey };
      }
    }
    return { ...base, payload: fallbackPayload };
  }

  return {
    ...base,
    payload: normalized.payload.length > 0 ? normalized.payload : fallbackPayload,
  };
}
