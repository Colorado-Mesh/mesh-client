import { MAX_RAW_PACKET_LOG_ENTRIES } from './rawPacketLogConstants';

/** Correlation window: event 7/8 must arrive within this many ms of the matching event 136. */
export const MESHCORE_CHAT_CORRELATE_WINDOW_MS = 3000;

/** Minimal shape needed for chat-entry correlation (avoids importing RxPacketEntry from useMeshcoreRuntime). */
export interface ChatCorrelateRxLike {
  ts: number;
  payloadTypeString: string | null;
  fromNodeId: number | null;
  advertName?: string | null;
  hopCount?: number;
  /** When false, hopCount is unreliable (failed parse / synthetic chat row). Absent = trusted. */
  parseOk?: boolean;
  /** CRC-32 packet fingerprint (8 hex chars) when known from RF parse. */
  messageFingerprintHex?: string | null;
}

/** Optional DM hop-correlation match against the ingesting event's sender. */
export interface MeshcoreTxtMsgHopMatch {
  /** Companion / PacketRouter sender node id (`event.payload.from`). */
  fromNodeId?: number | null;
  /** Optional RF packet fingerprint when available on the chat path. */
  messageFingerprintHex?: string | null;
}

function normalizeCorrelateFingerprint(hex: string | null | undefined): string | null {
  if (typeof hex !== 'string') return null;
  const t = hex.trim();
  if (!/^[0-9A-Fa-f]{8}$/.test(t)) return null;
  return t.toUpperCase();
}

function meshcoreTxtMsgRawPacketMatchesSender(
  entry: ChatCorrelateRxLike,
  match?: MeshcoreTxtMsgHopMatch,
): boolean {
  if (!match) return true;
  const wantFp = normalizeCorrelateFingerprint(match.messageFingerprintHex);
  if (wantFp && normalizeCorrelateFingerprint(entry.messageFingerprintHex) === wantFp) {
    return true;
  }
  const wantFrom = match.fromNodeId;
  if (wantFrom != null && wantFrom !== 0 && entry.fromNodeId === wantFrom) {
    return true;
  }
  // No usable sender constraint → keep prior any-TXT_MSG behavior.
  if ((wantFrom == null || wantFrom === 0) && !wantFp) return true;
  return false;
}

/**
 * Correlate an incoming DM (event 7) or channel message (event 8) with raw packet log entries.
 *
 * Two outcomes:
 * - If a recent unattributed entry of the matching payload type is found within `windowMs`, its
 *   `fromNodeId` is backfilled (fixes "no sender name" for TXT_MSG/GRP_TXT rows).
 * - If no match is found, `synthetic` is appended (fixes chat packets missing from raw log).
 */
export function meshcoreCorrelateOrSynthesizeChatEntry<T extends ChatCorrelateRxLike>(
  prev: T[],
  payloadTypeString: 'TXT_MSG' | 'GRP_TXT',
  fromNodeId: number | null,
  synthetic: T,
  windowMs: number = MESHCORE_CHAT_CORRELATE_WINDOW_MS,
): T[] {
  const now = synthetic.ts;
  for (let i = prev.length - 1; i >= 0; i--) {
    const e = prev[i];
    if (now - e.ts > windowMs) break;
    if (e.payloadTypeString === payloadTypeString && e.fromNodeId === null) {
      const updated = prev.slice();
      updated[i] = { ...e, fromNodeId };
      return updated;
    }
  }
  const next = [...prev, synthetic];
  return next.length > MAX_RAW_PACKET_LOG_ENTRIES
    ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
    : next;
}

/** Most recent GRP_TXT raw log row within the chat correlation window (any fromNodeId). */
export function meshcoreFindRecentGrpTxtRawPacket<T extends ChatCorrelateRxLike>(
  prev: readonly T[],
  now: number,
  windowMs: number = MESHCORE_CHAT_CORRELATE_WINDOW_MS,
): T | undefined {
  for (let i = prev.length - 1; i >= 0; i--) {
    const e = prev[i];
    if (now - e.ts > windowMs) break;
    if (e.payloadTypeString === 'GRP_TXT') return e;
  }
  return undefined;
}

/**
 * Most recent TXT_MSG raw log row within the chat correlation window.
 * When `match` includes a sender id or fingerprint, only that sender's row is used
 * so interleaved DMs in the window cannot steal hop counts.
 */
export function meshcoreFindRecentTxtMsgRawPacket<T extends ChatCorrelateRxLike>(
  prev: readonly T[],
  now: number,
  windowMs: number = MESHCORE_CHAT_CORRELATE_WINDOW_MS,
  match?: MeshcoreTxtMsgHopMatch,
): T | undefined {
  for (let i = prev.length - 1; i >= 0; i--) {
    const e = prev[i];
    if (now - e.ts > windowMs) break;
    if (e.payloadTypeString !== 'TXT_MSG') continue;
    if (!meshcoreTxtMsgRawPacketMatchesSender(e, match)) continue;
    return e;
  }
  return undefined;
}

/** Resolve RF hop count for driver-path ingest from the raw packet log (event 136). */
export function resolveMeshcoreIngestRxHops(
  rawPackets: readonly ChatCorrelateRxLike[],
  isChannel: boolean,
  now: number = Date.now(),
  txtMsgMatch?: MeshcoreTxtMsgHopMatch,
): number | undefined {
  const match = isChannel
    ? meshcoreFindRecentGrpTxtRawPacket(rawPackets, now)
    : meshcoreFindRecentTxtMsgRawPacket(
        rawPackets,
        now,
        MESHCORE_CHAT_CORRELATE_WINDOW_MS,
        txtMsgMatch,
      );
  // Failed parses / synthetic chat rows default hopCount to 0 — do not adopt those.
  if (!match || match.parseOk === false) return undefined;
  const hops = match.hopCount;
  return hops != null && Number.isFinite(hops) ? hops : undefined;
}
