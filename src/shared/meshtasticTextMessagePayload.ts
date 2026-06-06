import { fromBinary } from '@bufbuild/protobuf';

import { meshtasticStoreAndForwardSchema } from './meshtasticProtobufSchemas';

/** Max share of control bytes (excluding tab/LF/CR) before payload is treated as non-chat. */
export const MESHTASTIC_CHAT_CONTROL_BYTE_RATIO_MAX = 0.25;

export interface ResolvedMeshtasticTextPayload {
  text: string;
  viaStoreForward?: boolean;
}

function parseStoreForwardPacket(data: Uint8Array): {
  rr: number;
  variant: { case?: string; value?: unknown };
} | null {
  if (!data.length) return null;
  try {
    return fromBinary(meshtasticStoreAndForwardSchema, data) as unknown as {
      rr: number;
      variant: { case?: string; value?: unknown };
    };
  } catch {
    // catch-no-log-ok malformed StoreAndForward protobuf
    return null;
  }
}

/**
 * Returns false when payload is mostly non-printable control bytes (corrupt decrypt, mis-ported SF).
 */
export function isLikelyReadableChatText(bytes: Uint8Array): boolean {
  if (!bytes.length) return true;
  let control = 0;
  for (const b of bytes) {
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) control++;
  }
  return control / bytes.length <= MESHTASTIC_CHAT_CONTROL_BYTE_RATIO_MAX;
}

export function decodeStoreForwardTextPayload(data: Uint8Array): string | null {
  const parsed = parseStoreForwardPacket(data);
  if (!parsed) return null;
  if (parsed.variant.case !== 'text') return null;
  const textBytes = parsed.variant.value;
  if (!(textBytes instanceof Uint8Array) || !textBytes.length) return null;
  const text = new TextDecoder().decode(textBytes).trim();
  return text || null;
}

/**
 * Resolve TEXT_MESSAGE_APP payload for chat ingest (RF and MQTT).
 * Failure point: mis-ported StoreAndForward or corrupt binary on text port.
 * Fallback: return null so callers skip chat insert.
 */
export function resolveMeshtasticTextMessagePayload(
  data: Uint8Array,
): ResolvedMeshtasticTextPayload | null {
  const parsed = parseStoreForwardPacket(data);
  if (parsed) {
    if (parsed.variant.case === 'text') {
      const sfText = decodeStoreForwardTextPayload(data);
      if (sfText != null) {
        return { text: sfText, viaStoreForward: true };
      }
      return null;
    }
    return null;
  }

  if (!isLikelyReadableChatText(data)) {
    return null;
  }

  const text = new TextDecoder().decode(data);
  return { text };
}
