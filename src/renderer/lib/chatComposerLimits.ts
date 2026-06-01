import type { MeshProtocol } from './types';

export const MESHTASTIC_PAYLOAD_LIMIT = 228;
/** Conservative default when channel display name is unknown (≈160 − 25 − 2). */
export const MESHCORE_PAYLOAD_LIMIT = 133;
export const MAX_CHUNKS = 9;

export const MESHCORE_WIRE_MAX = 160;
export const MESHCORE_MAX_NAME_LEN = 32;
export const MESHCORE_NAME_SUFFIX_LEN = 2; // ": "
export const MESHCORE_ROOM_PUBKEY_PREFIX_LEN = 4;

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
  return protocol === 'meshcore' ? MESHCORE_PAYLOAD_LIMIT : MESHTASTIC_PAYLOAD_LIMIT;
}

export function getMeshcoreChannelPayloadLimit(displayName: string): number {
  const nameLen = Math.min(countMessageChars(displayName.trim()), MESHCORE_MAX_NAME_LEN);
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
  const ctx = opts.composerContext ?? 'channel';
  if (ctx === 'room') return getMeshcoreRoomPayloadLimit();
  if (ctx === 'dm') return getMeshcoreDmPayloadLimit();
  return getMeshcoreChannelPayloadLimit(opts.senderDisplayName ?? '');
}

/** MeshCore reply wire prefix `@[Name] ` on the first chunk only. */
export function getComposerWireOverhead(opts: {
  protocol: MeshProtocol;
  replyToSenderName?: string;
}): number {
  if (opts.protocol !== 'meshcore' || !opts.replyToSenderName?.trim()) return 0;
  return countMessageChars(`@[${opts.replyToSenderName.trim()}] `);
}

export function countMessageChars(text: string): number {
  return Array.from(text).length;
}

/** Max user-typed characters across MAX_CHUNKS split messages. */
export function computeComposerTotalMaxChars(
  singleMessageLimit: number,
  wireOverheadFirstChunk = 0,
): number {
  const prefixLen = `[${MAX_CHUNKS}/${MAX_CHUNKS}] `.length;
  const firstBody = singleMessageLimit - prefixLen - wireOverheadFirstChunk;
  const otherBody = singleMessageLimit - prefixLen;
  if (firstBody <= 0) return 0;
  if (MAX_CHUNKS <= 1) return firstBody;
  return firstBody + (MAX_CHUNKS - 1) * otherBody;
}

export function computeComposerLimitStatus(
  text: string,
  protocol: MeshProtocol,
  opts?: {
    payloadLimitOverride?: number;
    composerContext?: ComposerWireContext;
    senderDisplayName?: string;
    replyToSenderName?: string;
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
  });
  const trimmed = text.trim();
  const charCount = countMessageChars(trimmed);
  const showThreshold = Math.floor(singleMessageLimit * 0.8);
  const totalMaxChars = computeComposerTotalMaxChars(singleMessageLimit, wireOverheadFirstChunk);

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
 * the text would require more than MAX_CHUNKS chunks.
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
      if (remaining.length <= bodyLimit) {
        bodies.push(remaining.join(''));
        break;
      }
      const window = remaining.slice(0, bodyLimit);
      let breakAt = bodyLimit;
      for (let i = bodyLimit - 1; i > 0; i--) {
        if (window[i] === ' ' || window[i] === '\n') {
          breakAt = i;
          break;
        }
      }
      const body = window.slice(0, breakAt).join('').trimEnd();
      bodies.push(body);
      pos += breakAt === bodyLimit ? bodyLimit : breakAt + 1;
      isFirst = false;
    }
    return bodies;
  }

  if (countMessageChars(trimmed) + overhead <= limit) return [];

  const estimatedPrefixLen = `[${MAX_CHUNKS}/${MAX_CHUNKS}] `.length;
  const bodies = chunkBodies(estimatedPrefixLen);

  if (bodies.length > MAX_CHUNKS) return null;

  const total = bodies.length;
  const actualPrefixLen = `[1/${total}] `.length;
  const finalBodies =
    actualPrefixLen === estimatedPrefixLen ? bodies : chunkBodies(actualPrefixLen);

  if (finalBodies.length > MAX_CHUNKS) return null;
  const finalTotal = finalBodies.length;
  return finalBodies.map((body, i) => `[${i + 1}/${finalTotal}] ${body}`);
}
