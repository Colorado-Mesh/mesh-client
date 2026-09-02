import {
  formatMeshcoreWireReplyPrefix,
  formatMeshcoreWireTapbackPrefix,
} from './meshcoreChannelText';
import { getRadioCapabilities } from './radio/providerFactory';
import type { MeshProtocol } from './types';

export const MESHTASTIC_PAYLOAD_LIMIT = 228;
/** Conservative default when channel display name is unknown (≈160 − 25 − 2). */
export const MESHCORE_PAYLOAD_LIMIT = 133;
/** LXMF DM text limit for composer (sidecar handles wire encoding; no Meshtastic-style chunking). */
export const RETICULUM_LXMF_PAYLOAD_LIMIT = 4096;
/** Keep in sync with `ProtocolCapabilities.composerMaxChunks` for Meshtastic/Reticulum. */
export const MAX_CHUNKS = 9;

/**
 * Max chunks a composer will split a message into, per protocol. Sourced from
 * `ProtocolCapabilities.composerMaxChunks` (MeshCore = 1: no multi-part `[i/N]` split).
 * See meshcore-dev/MeshCore #1502 / #2820. Inbound multi-part from other clients is unaffected.
 */
export function getMaxChunks(protocol: MeshProtocol): number {
  return getRadioCapabilities(protocol).composerMaxChunks;
}

export const MESHCORE_WIRE_MAX = 160;
export const MESHCORE_MAX_NAME_LEN = 32;
export const MESHCORE_NAME_SUFFIX_LEN = 2; // ": "
export const MESHCORE_ROOM_PUBKEY_PREFIX_LEN = 4;

/**
 * Meshtastic `Data.reply_id` (field 7) is `fixed32`: 1 tag byte + 4 fixed value bytes = 5 bytes,
 * always, whenever a reply is sent — regardless of the referenced packet id's value. Unlike
 * MeshCore's reply prefix, this overhead is invisible wire bytes, not visible text, but it still
 * has to come out of the same payload budget or a near-limit reply overflows the radio's true
 * packet size and gets NAKed as TOO_LARGE.
 */
export const MESHTASTIC_REPLY_ID_WIRE_BYTES = 5;

export type ComposerWireContext = 'channel' | 'dm' | 'room';
export type ComposerLimitPhase = 'ok' | 'warn' | 'split' | 'overMax';

export interface ComposerLimitStatus {
  charCount: number;
  singleMessageLimit: number;
  /** 1 when a single message; N when split; 0 when over max chunks. */
  chunkCount: number;
  totalMaxChars: number;
  phase: ComposerLimitPhase;
  showThreshold: number;
}

export function getChatPayloadLimit(protocol: MeshProtocol, override?: number): number {
  if (override != null) return override;
  if (protocol === 'reticulum') return RETICULUM_LXMF_PAYLOAD_LIMIT;
  return protocol === 'meshcore' ? MESHCORE_PAYLOAD_LIMIT : MESHTASTIC_PAYLOAD_LIMIT;
}

export function getMeshcoreChannelPayloadLimit(displayName: string): number {
  // Cap by codepoints (companion name length), then charge real UTF-8 bytes for `Name: `
  // against the 160-byte wire max — multi-byte names previously under-reserved the body.
  const cappedName = Array.from(displayName.trim()).slice(0, MESHCORE_MAX_NAME_LEN).join('');
  const nameLen = countMessageWireBytes(cappedName);
  return Math.max(1, MESHCORE_WIRE_MAX - nameLen - MESHCORE_NAME_SUFFIX_LEN);
}

export function getMeshcoreRoomPayloadLimit(): number {
  return Math.max(1, MESHCORE_WIRE_MAX - MESHCORE_ROOM_PUBKEY_PREFIX_LEN);
}

export function getMeshcoreDmPayloadLimit(): number {
  return MESHCORE_WIRE_MAX;
}

export function getComposerPayloadLimit(opts: {
  protocol: MeshProtocol;
  composerContext?: ComposerWireContext;
  senderDisplayName?: string;
  payloadLimitOverride?: number;
}): number {
  if (opts.payloadLimitOverride != null) return opts.payloadLimitOverride;
  if (opts.protocol === 'meshtastic') return MESHTASTIC_PAYLOAD_LIMIT;
  if (opts.protocol === 'reticulum') return RETICULUM_LXMF_PAYLOAD_LIMIT;
  const ctx = opts.composerContext ?? 'channel';
  if (ctx === 'room') return getMeshcoreRoomPayloadLimit();
  if (ctx === 'dm') return getMeshcoreDmPayloadLimit();
  return getMeshcoreChannelPayloadLimit(opts.senderDisplayName ?? '');
}

/** Reply wire overhead on the first chunk only (MeshCore visible prefix; Meshtastic reply_id field). */
export function getComposerWireOverhead(opts: {
  protocol: MeshProtocol;
  replyToSenderName?: string;
  replyKey?: number;
  /** When true, count keyed `@[Name#key] ` overhead (MeshCore Open compat). */
  useKeyedReplies?: boolean;
}): number {
  if (opts.protocol === 'meshtastic') {
    return opts.replyKey != null && Number.isFinite(opts.replyKey) && opts.replyKey !== 0
      ? MESHTASTIC_REPLY_ID_WIRE_BYTES
      : 0;
  }
  if (opts.protocol !== 'meshcore' || !opts.replyToSenderName?.trim()) return 0;
  const key = opts.replyKey;
  // Reuse the exact wire-format builders so normalized names and unsafe-name fallbacks cannot
  // drift from what actually goes out on the wire. Empty names return above without a prefix.
  const prefix =
    opts.useKeyedReplies && key != null && Number.isFinite(key) && key > 0
      ? formatMeshcoreWireReplyPrefix(opts.replyToSenderName, key)
      : formatMeshcoreWireTapbackPrefix(opts.replyToSenderName);
  return countMessageWireBytes(`${prefix} `);
}

export function countMessageChars(text: string): number {
  return Array.from(text).length;
}

const wireTextEncoder = new TextEncoder();

/**
 * Real transport wire byte length (UTF-8), as opposed to `countMessageChars`' codepoint count.
 * Meshtastic and MeshCore both encode outbound text with `TextEncoder` before transmission, so
 * a codepoint count alone understates cost for any non-ASCII text (non-Latin scripts, emoji) —
 * this is what must be checked against real byte-based wire limits like `MESHTASTIC_PAYLOAD_LIMIT`.
 */
export function countMessageWireBytes(text: string): number {
  return wireTextEncoder.encode(text).length;
}

/**
 * Number of leading codepoints from `chars` whose combined UTF-8 byte length fits `byteBudget`.
 * Always takes at least one codepoint to guarantee forward progress, even when a single
 * multi-byte codepoint alone exceeds the budget (only possible with a pathologically tiny limit).
 */
function takeCharsWithinByteBudget(chars: readonly string[], byteBudget: number): number {
  let bytes = 0;
  let count = 0;
  for (const ch of chars) {
    const chBytes = countMessageWireBytes(ch);
    if (count > 0 && bytes + chBytes > byteBudget) break;
    bytes += chBytes;
    count++;
  }
  return count;
}

/** Max user-typed characters across `maxChunks` split messages (1 = single-packet only). */
export function computeComposerTotalMaxChars(
  singleMessageLimit: number,
  wireOverheadFirstChunk = 0,
  maxChunks = MAX_CHUNKS,
): number {
  if (maxChunks <= 1) {
    // Single packet only: no `[i/N]` prefix is reserved, only the first-chunk wire overhead.
    const singleBody = singleMessageLimit - wireOverheadFirstChunk;
    return singleBody > 0 ? singleBody : 0;
  }
  const prefixLen = `[${maxChunks}/${maxChunks}] `.length;
  const firstBody = singleMessageLimit - prefixLen - wireOverheadFirstChunk;
  const otherBody = singleMessageLimit - prefixLen;
  if (firstBody <= 0) return 0;
  return firstBody + (maxChunks - 1) * otherBody;
}

export function computeComposerLimitStatus(
  text: string,
  protocol: MeshProtocol,
  opts?: {
    payloadLimitOverride?: number;
    composerContext?: ComposerWireContext;
    senderDisplayName?: string;
    replyToSenderName?: string;
    replyKey?: number;
    useKeyedReplies?: boolean;
  },
): ComposerLimitStatus {
  const singleMessageLimit = getComposerPayloadLimit({
    protocol,
    composerContext: opts?.composerContext,
    senderDisplayName: opts?.senderDisplayName,
    payloadLimitOverride: opts?.payloadLimitOverride,
  });
  const wireOverheadFirstChunk = getComposerWireOverhead({
    protocol,
    replyToSenderName: opts?.replyToSenderName,
    replyKey: opts?.replyKey,
    useKeyedReplies: opts?.useKeyedReplies,
  });
  const trimmed = text.trim();
  const charCount = countMessageChars(trimmed);
  const showThreshold = Math.floor(singleMessageLimit * 0.8);
  const totalMaxChars = computeComposerTotalMaxChars(
    singleMessageLimit,
    wireOverheadFirstChunk,
    getMaxChunks(protocol),
  );

  const chunks = splitChatMessage(trimmed, protocol, singleMessageLimit, wireOverheadFirstChunk);

  let phase: ComposerLimitPhase = 'ok';
  let chunkCount = 1;

  if (chunks === null) {
    phase = 'overMax';
    chunkCount = 0;
  } else if (chunks.length > 0) {
    phase = 'split';
    chunkCount = chunks.length;
  } else if (charCount >= showThreshold) {
    phase = 'warn';
  }

  return {
    charCount,
    singleMessageLimit,
    chunkCount,
    totalMaxChars,
    phase,
    showThreshold,
  };
}

/**
 * Split text into N chunks each prefixed "[i/N] " so every chunk fits in the protocol payload
 * limit. Returns [] when text fits in a single message (no chunking needed). Returns null when
 * the text would require more than the protocol's max chunks (`getMaxChunks`); MeshCore is capped
 * at 1, so any over-limit MeshCore text returns null (no multi-part split).
 *
 * Splitting prefers word boundaries; hard-splits only when a single token exceeds the available
 * body space.
 *
 * @param wireOverheadFirstChunk Extra wire chars on chunk 1 only (e.g. MeshCore `@[Name] ` reply).
 */
export function splitChatMessage(
  text: string,
  protocol: MeshProtocol,
  payloadLimit?: number,
  wireOverheadFirstChunk = 0,
): string[] | null {
  const limit = getChatPayloadLimit(protocol, payloadLimit);
  const trimmed = text.trim();
  const overhead = Math.max(0, wireOverheadFirstChunk);
  const maxChunks = getMaxChunks(protocol);

  function chunkBodies(prefixLen: number): string[] {
    const bodies: string[] = [];
    const chars = Array.from(trimmed);
    let pos = 0;
    let isFirst = true;

    while (pos < chars.length) {
      const extraOverhead = isFirst ? overhead : 0;
      const bodyLimit = limit - prefixLen - extraOverhead;
      if (bodyLimit <= 0) return bodies;

      const remaining = chars.slice(pos);
      if (countMessageWireBytes(remaining.join('')) <= bodyLimit) {
        bodies.push(remaining.join(''));
        break;
      }
      // bodyLimit is a byte budget (real wire limits are byte limits), so the window must be
      // sized by accumulated UTF-8 byte length, not codepoint count.
      const windowLen = takeCharsWithinByteBudget(remaining, bodyLimit);
      const window = remaining.slice(0, windowLen);
      let breakAt = windowLen;
      for (let i = windowLen - 1; i > 0; i--) {
        if (window[i] === ' ' || window[i] === '\n') {
          breakAt = i;
          break;
        }
      }
      const body = window.slice(0, breakAt).join('').trimEnd();
      bodies.push(body);
      pos += breakAt === windowLen ? windowLen : breakAt + 1;
      isFirst = false;
    }
    return bodies;
  }

  if (countMessageWireBytes(trimmed) + overhead <= limit) return [];

  // Protocols capped at a single packet (MeshCore) never split: over-limit text is rejected
  // so the composer treats it as `overMax` and blocks the send.
  if (maxChunks <= 1) return null;

  const estimatedPrefixLen = `[${maxChunks}/${maxChunks}] `.length;
  const bodies = chunkBodies(estimatedPrefixLen);

  if (bodies.length > maxChunks) return null;

  const total = bodies.length;
  const actualPrefixLen = `[1/${total}] `.length;
  const finalBodies =
    actualPrefixLen === estimatedPrefixLen ? bodies : chunkBodies(actualPrefixLen);

  if (finalBodies.length > maxChunks) return null;
  const finalTotal = finalBodies.length;
  return finalBodies.map((body, i) => `[${i + 1}/${finalTotal}] ${body}`);
}
