import { meshtasticWireUint32AllowZero } from '@/shared/reactionEmoji';

import type { ChatMessage } from './types';

/** Align with seenPacketIds TTL in useMeshtasticRuntime. */
export const MESHTASTIC_CROSS_TRANSPORT_DEDUP_WINDOW_MS = 10 * 60 * 1000;

const CROSS_TRANSPORT_SCAN_LIMIT = 200;

export function normalizeMeshtasticPacketId(v: unknown): number | undefined {
  return meshtasticWireUint32AllowZero(v);
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

/** Upgrade the matching row to `receivedVia: 'both'` when the other transport already has this message. */
export function mapMeshtasticCrossTransportUpgrade(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
  windowMs: number = MESHTASTIC_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
): MeshtasticCrossTransportUpgradeResult {
  const hit = findMeshtasticCrossTransportDuplicate(messages, incoming, windowMs);
  if (!hit) {
    return { messages: [...messages], matched: false };
  }
  const incomingPid = normalizeMeshtasticPacketId(incoming.packetId);
  const bestPid = incomingPid !== undefined && incomingPid !== 0 ? incomingPid : undefined;
  const hitPid = normalizeMeshtasticPacketId(hit.packetId);
  const packetIdForDb = bestPid ?? (hitPid !== undefined && hitPid !== 0 ? hitPid : undefined);
  let matched = false;
  const next = messages.map((m) => {
    if (!meshtasticCrossTransportMatch(m, incoming, windowMs)) return m;
    matched = true;
    const existingPid = normalizeMeshtasticPacketId(m.packetId);
    const packetId =
      bestPid ?? (existingPid !== undefined && existingPid !== 0 ? existingPid : m.packetId);
    return {
      ...m,
      receivedVia: 'both' as const,
      rxHops: m.rxHops ?? incoming.rxHops,
      ...(packetId !== undefined ? { packetId } : {}),
    };
  });
  return {
    messages: matched ? next : [...messages],
    matched,
    packetIdForDb,
  };
}
