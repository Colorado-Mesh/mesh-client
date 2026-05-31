import type { MeshProtocol } from './types';

export const MESHTASTIC_PAYLOAD_LIMIT = 228;
export const MESHCORE_PAYLOAD_LIMIT = 133;
export const MAX_CHUNKS = 9;

export function getChatPayloadLimit(protocol: MeshProtocol, override?: number): number {
  if (override != null) return override;
  return protocol === 'meshcore' ? MESHCORE_PAYLOAD_LIMIT : MESHTASTIC_PAYLOAD_LIMIT;
}

export function countMessageChars(text: string): number {
  return Array.from(text).length;
}

/**
 * Split text into N chunks each prefixed "[i/N] " so every chunk fits in the protocol payload
 * limit. Returns [] when text fits in a single message (no chunking needed). Returns null when
 * the text would require more than MAX_CHUNKS chunks.
 *
 * Splitting prefers word boundaries; hard-splits only when a single token exceeds the available
 * body space.
 */
export function splitChatMessage(
  text: string,
  protocol: MeshProtocol,
  payloadLimit?: number,
): string[] | null {
  const limit = getChatPayloadLimit(protocol, payloadLimit);
  const trimmed = text.trim();

  // How much body space does "[N/N] " cost? Prefix length depends on total chunk count.
  // Estimate upper bound: use MAX_CHUNKS (2-digit) → "[9/9] " = 6 chars.
  // We'll iterate once with that estimate; actual prefix is shorter for single digits.
  function chunkBodies(prefixLen: number): string[] {
    const bodyLimit = limit - prefixLen;
    if (bodyLimit <= 0) return [];
    const chars = Array.from(trimmed);
    const bodies: string[] = [];
    let pos = 0;
    while (pos < chars.length) {
      const remaining = chars.slice(pos);
      if (remaining.length <= bodyLimit) {
        bodies.push(remaining.join(''));
        break;
      }
      // Try to break on a word boundary within the window
      const window = remaining.slice(0, bodyLimit);
      let breakAt = bodyLimit;
      for (let i = bodyLimit - 1; i > 0; i--) {
        if (window[i] === ' ' || window[i] === '\n') {
          breakAt = i;
          break;
        }
      }
      // If no word boundary found (long token), hard-split at bodyLimit
      const body = window.slice(0, breakAt).join('').trimEnd();
      bodies.push(body);
      // Advance past the break character (space/newline) if we found one
      pos += breakAt === bodyLimit ? bodyLimit : breakAt + 1;
    }
    return bodies;
  }

  // Check if it fits in one message first
  if (countMessageChars(trimmed) <= limit) return [];

  // Estimate prefix size with MAX_CHUNKS to get conservative body size
  const estimatedPrefixLen = `[${MAX_CHUNKS}/${MAX_CHUNKS}] `.length; // "[9/9] " = 6
  const bodies = chunkBodies(estimatedPrefixLen);

  if (bodies.length > MAX_CHUNKS) return null;

  // Re-derive with actual total to get tighter prefix (e.g. "[1/3] " = 6 chars too, but "[1/1]" won't happen here)
  const total = bodies.length;
  const actualPrefixLen = `[1/${total}] `.length;
  // If the actual prefix is the same length, we're done; otherwise redo
  const finalBodies =
    actualPrefixLen === estimatedPrefixLen ? bodies : chunkBodies(actualPrefixLen);

  if (finalBodies.length > MAX_CHUNKS) return null;
  const finalTotal = finalBodies.length;
  return finalBodies.map((body, i) => `[${i + 1}/${finalTotal}] ${body}`);
}
