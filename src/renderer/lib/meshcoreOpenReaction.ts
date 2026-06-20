/**
 * MeshCore Open (meshcore-open-mx) reaction wire format: `r:HASH:INDEX`.
 * @see https://github.com/musznik/meshcore-open-mx/blob/dev/lib/helpers/reaction_helper.dart
 */

import { normalizeReactionEmoji } from './reactions';
import { truncateReplyPreviewText } from './replyPreview';
import type { ChatMessage } from './types';

/** Stable emoji table — order must match MeshCore Open `ReactionHelper.reactionEmojis`. */
export const MESHCORE_OPEN_REACTION_EMOJIS: readonly string[] = [
  '👍',
  '❤️',
  '😂',
  '🎉',
  '👏',
  '🔥',
  '😀',
  '😃',
  '😄',
  '😁',
  '😅',
  '😂',
  '🤣',
  '😊',
  '😇',
  '🙂',
  '🙃',
  '😉',
  '😌',
  '😍',
  '🥰',
  '😘',
  '😗',
  '😙',
  '😚',
  '😋',
  '😛',
  '😝',
  '😜',
  '🤪',
  '🤨',
  '🧐',
  '🤓',
  '😎',
  '🥸',
  '🤩',
  '🥳',
  '😏',
  '😒',
  '😞',
  '😔',
  '😟',
  '😕',
  '🙁',
  '😣',
  '😖',
  '😫',
  '😩',
  '🥺',
  '😢',
  '😭',
  '😤',
  '😠',
  '😡',
  '🤬',
  '🤯',
  '😳',
  '🥵',
  '🥶',
  '😱',
  '😨',
  '😰',
  '😥',
  '😓',
  '🤗',
  '🤔',
  '🤭',
  '🤫',
  '🤥',
  '😶',
  '👍',
  '👎',
  '👊',
  '✊',
  '🤛',
  '🤜',
  '🤞',
  '✌️',
  '🤟',
  '🤘',
  '👌',
  '🤌',
  '🤏',
  '👈',
  '👉',
  '👆',
  '👇',
  '☝️',
  '👋',
  '🤚',
  '🖐️',
  '✋',
  '🖖',
  '👏',
  '🙌',
  '👐',
  '🤲',
  '🤝',
  '🙏',
  '✍️',
  '💅',
  '🤳',
  '💪',
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '🖤',
  '🤍',
  '🤎',
  '💔',
  '❤️‍🔥',
  '❤️‍🩹',
  '💕',
  '💞',
  '💓',
  '💗',
  '💖',
  '💘',
  '💝',
  '💟',
  '💌',
  '💢',
  '💥',
  '💫',
  '💦',
  '💨',
  '🕳️',
  '💬',
  '👁️‍🗨️',
  '🗨️',
  '🗯️',
  '💭',
  '🎉',
  '🎊',
  '🎈',
  '🎁',
  '🎀',
  '🪅',
  '🪆',
  '🏆',
  '🥇',
  '🥈',
  '🥉',
  '⚽',
  '⚾',
  '🥎',
  '🏀',
  '🏐',
  '🏈',
  '🏉',
  '🎾',
  '🥏',
  '🎳',
  '🏏',
  '🏑',
  '🏒',
  '🥍',
  '🏓',
  '🏸',
  '🥊',
  '🥋',
  '🥅',
  '⛳',
  '🔥',
  '⭐',
  '🌟',
  '✨',
  '⚡',
  '💡',
  '🔦',
  '🏮',
  '🪔',
  '📱',
  '💻',
  '⌚',
  '📷',
  '📺',
  '📻',
  '🎵',
  '🎶',
  '🚀',
] as const;

const MESHCORE_OPEN_REACTION_WIRE = /^r:([0-9a-f]{4}):([0-9a-f]{2})$/i;

/** Dart VM `StringHasher` + 30-bit finalize — matches MeshCore Open `String.hashCode`. */
export function dartStringHashCode(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = combineDartHashes(hash, text.charCodeAt(i));
  }
  return finalizeDartHash(hash, 30);
}

function combineDartHashes(hash: number, other: number): number {
  hash = (hash + other) >>> 0;
  hash = (hash + ((hash << 10) >>> 0)) >>> 0;
  hash = (hash ^ (hash >>> 6)) >>> 0;
  return hash;
}

function finalizeDartHash(hash: number, hashBits: number): number {
  hash = (hash + ((hash << 3) >>> 0)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + ((hash << 15) >>> 0)) >>> 0;
  if (hashBits < 32) {
    hash = hash & ((1 << hashBits) - 1);
  }
  const finalized = hash === 0 ? 1 : hash;
  return finalized > 0x7fffffff ? finalized - 0x1_0000_0000 : finalized;
}

/** 4-char hex reaction target hash (MeshCore Open). */
export function computeMeshcoreOpenReactionHash(
  timestampSeconds: number,
  senderName: string | null | undefined,
  text: string,
): string {
  const first5 = text.length >= 5 ? text.slice(0, 5) : text;
  const trimmedName = senderName?.trim();
  const input =
    trimmedName != null && trimmedName.length > 0
      ? `${timestampSeconds}${trimmedName}${first5}`
      : `${timestampSeconds}${first5}`;
  const hash = dartStringHashCode(input) & 0xffff;
  return hash.toString(16).padStart(4, '0');
}

export function meshcoreOpenEmojiToIndex(glyph: string): string | null {
  const idx = MESHCORE_OPEN_REACTION_EMOJIS.indexOf(glyph);
  if (idx < 0) return null;
  return idx.toString(16).padStart(2, '0');
}

export function isMeshcoreInteroperableReactionGlyph(glyph: string): boolean {
  return meshcoreOpenEmojiToIndex(glyph) != null;
}

export function meshcoreOpenIndexToEmoji(hexIndex: string): string | null {
  const idx = Number.parseInt(hexIndex, 16);
  if (!Number.isFinite(idx) || idx < 0 || idx >= MESHCORE_OPEN_REACTION_EMOJIS.length) {
    return null;
  }
  return MESHCORE_OPEN_REACTION_EMOJIS[idx] ?? null;
}

export function formatMeshcoreOpenReactionWire(hash: string, emojiIndex: string): string {
  return `r:${hash.toLowerCase()}:${emojiIndex.toLowerCase()}`;
}

export interface MeshcoreOpenReactionWire {
  targetHash: string;
  emoji: string;
}

export function parseMeshcoreOpenReactionWire(text: string): MeshcoreOpenReactionWire | null {
  const trimmed = text.trim();
  const match = MESHCORE_OPEN_REACTION_WIRE.exec(trimmed);
  if (!match) return null;
  const emoji = meshcoreOpenIndexToEmoji(match[2]);
  if (emoji == null) return null;
  return { targetHash: match[1].toLowerCase(), emoji };
}

export function buildMeshcoreOpenReactionWire(
  targetMessage: ChatMessage,
  glyph: string,
  opts: { isDm: boolean },
): string | null {
  const emojiIndex = meshcoreOpenEmojiToIndex(glyph);
  if (emojiIndex == null) return null;
  const timestampSecs = Math.floor(targetMessage.timestamp / 1000);
  const senderName = opts.isDm ? null : targetMessage.sender_name;
  const hash = computeMeshcoreOpenReactionHash(timestampSecs, senderName, targetMessage.payload);
  return formatMeshcoreOpenReactionWire(hash, emojiIndex);
}

export interface MeshcoreOpenReactionParentLookup {
  channel: number;
  beforeTimestamp: number;
  isDm: boolean;
}

/** Resolve parent message for inbound `r:HASH:INDEX` (newest match in thread). */
export function findMeshcoreOpenReactionParent(
  messages: readonly ChatMessage[],
  targetHash: string,
  opts: MeshcoreOpenReactionParentLookup,
): ChatMessage | undefined {
  const wantHash = targetHash.toLowerCase();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.timestamp >= opts.beforeTimestamp) continue;
    if (opts.isDm) {
      if (m.channel !== -1) continue;
    } else {
      if (m.channel !== opts.channel || m.to != null) continue;
    }
    if (m.emoji != null && m.replyId != null) continue;
    const tsSec = Math.floor(m.timestamp / 1000);
    const senderName = opts.isDm ? null : m.sender_name;
    const hash = computeMeshcoreOpenReactionHash(tsSec, senderName, m.payload);
    // catch-no-log-ok timing-safe compare not needed for public mesh reaction hash lookup
    if (hash.toLowerCase() === wantHash) return m;
  }
  return undefined;
}

export function buildMeshcoreOpenReactionIncomingMessage(
  messages: readonly ChatMessage[],
  base: Pick<
    ChatMessage,
    'sender_id' | 'sender_name' | 'channel' | 'timestamp' | 'status' | 'receivedVia' | 'to'
  > & { meshcoreDedupeKey: string },
  wire: MeshcoreOpenReactionWire,
  lookup: MeshcoreOpenReactionParentLookup,
): ChatMessage {
  const emojiScalar = normalizeReactionEmoji(undefined, wire.emoji);
  const parent = findMeshcoreOpenReactionParent(messages, wire.targetHash, lookup);
  const previewFields = parent
    ? {
        replyPreviewText: truncateReplyPreviewText(parent.payload),
        replyPreviewSender: parent.sender_name,
      }
    : undefined;
  const replyId = parent ? (parent.packetId ?? parent.timestamp) : undefined;
  return {
    ...base,
    payload: wire.emoji,
    ...(emojiScalar != null ? { emoji: emojiScalar } : {}),
    ...(replyId != null ? { replyId } : {}),
    ...previewFields,
  };
}
