/**
 * MeshCom serial/BLE chat wire budget: address prefix + body ≤ 160 UTF-8 bytes
 * (kocel / MeshCom radio parity). EXTUDP JSON `msg` stays capped separately at 150.
 */

import { MESHCOM_WIRE_MAX_BYTES } from '@/shared/meshcomConstants';

import { normalizeMeshcomCallsign } from './meshcomCallsign';
import { meshcomOutboundDest } from './meshcomChannel';
import { MESHCOM_EXTUDP_MSG_MAX_LEN } from './meshcomExtUdpCodec';

export { MESHCOM_WIRE_MAX_BYTES };

const wireTextEncoder = new TextEncoder();

function utf8ByteLength(text: string): number {
  return wireTextEncoder.encode(text).length;
}

/**
 * Serial/BLE address prefix for a wire destination (`*` / empty → none;
 * group id or callsign → `{dest}`).
 */
export function meshcomAddressPrefix(wireDest: string): string {
  const dest = wireDest.trim();
  if (!dest || dest === '*') return '';
  if (/^\d+$/.test(dest)) return `{${dest}}`;
  const call = normalizeMeshcomCallsign(dest);
  return call ? `{${call}}` : '';
}

/** UTF-8 byte length of the address prefix (0 for ALL). */
export function meshcomAddressOverheadBytes(wireDest: string): number {
  return utf8ByteLength(meshcomAddressPrefix(wireDest));
}

/**
 * Max UTF-8 body bytes for a destination. When `capExtUdp` is true, also clamp
 * to EXTUDP JSON `msg` max (150).
 */
export function meshcomBodyBudgetBytes(wireDest: string, opts?: { capExtUdp?: boolean }): number {
  const overhead = meshcomAddressOverheadBytes(wireDest);
  const radioBody = Math.max(1, MESHCOM_WIRE_MAX_BYTES - overhead);
  if (opts?.capExtUdp) {
    return Math.max(1, Math.min(radioBody, MESHCOM_EXTUDP_MSG_MAX_LEN));
  }
  return radioBody;
}

/** Resolve body budget from chat channel / DM fields (same rules as outbound dest). */
export function meshcomBodyBudgetForChat(opts: {
  channelIndex?: number;
  destinationCallsign?: string;
  capExtUdp?: boolean;
}): number {
  const wireDest = meshcomOutboundDest({
    channelIndex: opts.channelIndex,
    destinationCallsign: opts.destinationCallsign,
  });
  return meshcomBodyBudgetBytes(wireDest, { capExtUdp: opts.capExtUdp });
}

/** Truncate `text` so its UTF-8 length is ≤ `maxBytes` (at least one codepoint when non-empty). */
export function truncateToWireBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8ByteLength(text) <= maxBytes) return text;
  const chars = Array.from(text);
  let bytes = 0;
  let count = 0;
  for (const ch of chars) {
    const chBytes = utf8ByteLength(ch);
    if (count > 0 && bytes + chBytes > maxBytes) break;
    bytes += chBytes;
    count++;
  }
  return chars.slice(0, count).join('');
}
