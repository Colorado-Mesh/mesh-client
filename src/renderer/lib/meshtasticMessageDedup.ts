import { meshtasticWireUint32AllowZero } from '@/shared/reactionEmoji';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

import type { ChatMessage } from './types';

/** Align with seenPacketIds TTL in useMeshtasticRuntime. */
export const MESHTASTIC_CROSS_TRANSPORT_DEDUP_WINDOW_MS = 10 * MS_PER_MINUTE;

const CROSS_TRANSPORT_SCAN_LIMIT = 200;

export function normalizeMeshtasticPacketId(v: unknown): number | undefined {
  return meshtasticWireUint32AllowZero(v);
}

/** Composite dedup key — packet ids may collide across different senders. */
export function meshtasticPacketDedupKey(senderId: number, packetId: number): string {
  return `${senderId >>> 0}:${packetId >>> 0}`;
}

/** Normalize payload for dedup (matches ingest placeholder stripping). */
export function normalizeMeshtasticDedupPayload(payload: unknown): string {
  if (typeof payload !== 'string') return '';
  const trimmed = payload.trim();
  return trimmed === '0' ? '' : payload;
}

function dmTarget(msg: Pick<ChatMessage, 'to'>): number | undefined {
  return msg.to;
}

function transportsAreCross(existing: ChatMessage, incoming: ChatMessage): boolean {
  const existingVia = existing.receivedVia;
  const incomingVia = incoming.receivedVia;
  if (!existingVia || !incomingVia) return false;
  if (existingVia === incomingVia) return false;
  return true;
}

/**
 * True when `existing` and `incoming` are the same text message on opposite transports
 * within the time window (RF/MQTT delayed duplicate).
 */
export function meshtasticCrossTransportMatch(
  existing: ChatMessage,
  incoming: ChatMessage,
  windowMs: number = MESHTASTIC_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
): boolean {
  if (existing.sender_id !== incoming.sender_id) return false;
  if (existing.channel !== incoming.channel) return false;
  if (dmTarget(existing) !== dmTarget(incoming)) return false;
  const existingIsReaction = existing.emoji != null || existing.replyId != null;
  const incomingIsReaction = incoming.emoji != null || incoming.replyId != null;
  if (existingIsReaction || incomingIsReaction) {
    if (!existingIsReaction || !incomingIsReaction) return false;
    if (existing.emoji !== incoming.emoji) return false;
    if (existing.replyId !== incoming.replyId) return false;
  } else if (
    normalizeMeshtasticDedupPayload(existing.payload) !==
    normalizeMeshtasticDedupPayload(incoming.payload)
  ) {
    return false;
  }
  if (Math.abs(existing.timestamp - incoming.timestamp) > windowMs) return false;
  return transportsAreCross(existing, incoming);
}

/**
 * Find a recent in-memory message that is the same content on the other transport.
 * Scans newest-first, capped at CROSS_TRANSPORT_SCAN_LIMIT rows.
 */
export function findMeshtasticCrossTransportDuplicate(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
  windowMs: number = MESHTASTIC_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
): ChatMessage | undefined {
  const start = Math.max(0, messages.length - CROSS_TRANSPORT_SCAN_LIMIT);
  for (let i = messages.length - 1; i >= start; i--) {
    const existing = messages[i];
    if (meshtasticCrossTransportMatch(existing, incoming, windowMs)) {
      return existing;
    }
  }
  return undefined;
}

/** Compare packet ids after uint32 coercion (for upgrade queries). */
export function meshtasticPacketIdsEqual(a: unknown, b: unknown): boolean {
  const na = normalizeMeshtasticPacketId(a);
  const nb = normalizeMeshtasticPacketId(b);
  if (na === undefined || nb === undefined) return false;
  return na === nb;
}

export interface MeshtasticCrossTransportUpgradeResult {
  messages: ChatMessage[];
  matched: boolean;
  packetIdForDb?: number;
}

/**
 * Wire reply_id uses firmware RF packet ids. MQTT uplink echoes carry broker-assigned ids —
 * never let those replace an RF id or a pending device-ack row id.
 */
export function resolveMeshtasticCrossTransportPacketId(
  existing: ChatMessage,
  incoming: ChatMessage,
): number | undefined {
  const existingPid = normalizeMeshtasticPacketId(existing.packetId);
  const incomingPid = normalizeMeshtasticPacketId(incoming.packetId);
  const existingFromRf = existing.receivedVia === 'rf' || existing.receivedVia === 'both';
  const incomingFromRf = incoming.receivedVia === 'rf';

  if (incomingFromRf && incomingPid) return incomingPid;
  if (existingFromRf && existingPid) return existingPid;

  // MQTT echo must not clobber device-ack / optimistic ids before RF is linked.
  if (existingPid && incoming.receivedVia === 'mqtt' && !incomingFromRf) {
    return existingPid;
  }

  if (incomingPid) return incomingPid;
  return existingPid;
}

/** Same text row already ingested live; S&F replay should merge flags, not duplicate. */
export function meshtasticStoreForwardContentMatch(
  existing: ChatMessage,
  incoming: ChatMessage,
): boolean {
  if (!incoming.viaStoreForward) return false;
  if (existing.sender_id !== incoming.sender_id) return false;
  if (existing.channel !== incoming.channel) return false;
  if (dmTarget(existing) !== dmTarget(incoming)) return false;
  return (
    normalizeMeshtasticDedupPayload(existing.payload) ===
    normalizeMeshtasticDedupPayload(incoming.payload)
  );
}

/** Find an existing live row for an S&F replay (no time window). */
export function findMeshtasticStoreForwardDuplicate(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
): ChatMessage | undefined {
  if (!incoming.viaStoreForward) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const existing = messages[i];
    if (meshtasticStoreForwardContentMatch(existing, incoming)) {
      return existing;
    }
  }
  return undefined;
}

/**
 * Upgrade the single nearest matching row to `receivedVia: 'both'` when the other transport
 * already has this message.
 *
 * Only the row returned by `findMeshtasticCrossTransportDuplicate` is upgraded — matching by
 * content predicate over the whole array would upgrade every row with identical sender/channel/
 * payload within the window (e.g. the same text repeated a few times), silently merging distinct
 * messages and writing the same resolved packetId onto multiple SQLite rows.
 */
export function mapMeshtasticCrossTransportUpgrade(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
  windowMs: number = MESHTASTIC_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
): MeshtasticCrossTransportUpgradeResult {
  const hit = findMeshtasticCrossTransportDuplicate(messages, incoming, windowMs);
  if (!hit) {
    return { messages: [...messages], matched: false };
  }
  const packetIdForDb = resolveMeshtasticCrossTransportPacketId(hit, incoming);
  const next = messages.map((m) => {
    if (m !== hit) return m;
    return {
      ...m,
      receivedVia: 'both' as const,
      rxHops: m.rxHops ?? incoming.rxHops,
      ...(packetIdForDb !== undefined ? { packetId: packetIdForDb } : {}),
    };
  });
  return {
    messages: next,
    matched: true,
    packetIdForDb,
  };
}
