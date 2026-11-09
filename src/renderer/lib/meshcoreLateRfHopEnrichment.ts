/**
 * Late event-136 → chat-row hop enrichment.
 *
 * When companion events 7/8 ingest before raw RF RX (136), or companion pathLen is
 * missing/wrong, patch the matching chat row from a successful RF parse. RF on-air
 * path length is authoritative when it disagrees with a stored hop count.
 *
 * The radio logs every reception (event 136) before it drops duplicates, and its message event
 * carries the first reception's path (MeshCore `Dispatcher::checkRecv`, `Mesh::onRecvPacket`).
 * So only a packet's first reception may change a row, and a channel packet only changes the
 * row it decrypts to: the next message's RX log usually arrives while the previous message is
 * still the newest row.
 */
import { decodeMeshcoreGroupText } from '@/shared/meshcoreGroupText';

import {
  MESHCORE_ROOM_MESSAGE_CHANNEL,
  messageToDbRow,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { getConnection } from '../stores/connectionStore';
import { upsertMessage, useMessageStore } from '../stores/messageStore';
import { errLikeToLogString } from './errLikeToLogString';
import { normalizeMeshcoreIncomingText } from './meshcoreChannelText';
import { MESHCORE_CHAT_CORRELATE_WINDOW_MS } from './meshcoreRawPacketCorrelate';
import { sanitizeMeshcoreChatWireText } from './meshcoreUtils';
import { effectiveMessageTimestampMs } from './nodeStatus';
import { messageRecordToChatMessage } from './storeRecordAdapters';
import type { ChatMessage, IdentityId } from './types';

/** How long the Chat hop label shows the “refined from RF” accent after a correction. */
export const MESHCORE_HOP_CORRECTED_UI_TTL_MS = 2000;

export interface MeshcoreLateHopCandidate {
  storeId: string;
  sender_id: number;
  sender_name?: string;
  payload?: string;
  /** Raw wire line (`Name: text`) for live rows; not persisted. */
  meshcoreDedupeKey?: string;
  channel: number;
  timestamp: number;
  rxHops?: number;
  receivedVia?: ChatMessage['receivedVia'];
  roomServerId?: number;
  rxPacketFingerprintHex?: string;
  status?: ChatMessage['status'];
}

/** A GRP_TXT packet's decrypted content, used to find the one chat row it belongs to. */
export interface MeshcoreLateHopGroupText {
  channel: number;
  timestampSec: number;
  /** Sanitized wire line, as stored in a live row's `meshcoreDedupeKey`. */
  rawText: string;
  senderName?: string;
  payload: string;
}

export interface MeshcoreLateRfHopEnrichmentInput {
  payloadTypeString: 'TXT_MSG' | 'GRP_TXT';
  hopCount: number;
  fromNodeId: number | null;
  messageFingerprintHex: string | null;
  parseOk: boolean;
  now?: number;
  myNodeNum?: number;
  windowMs?: number;
  /** GRP_TXT: decrypted content. Without it a channel packet changes no row. */
  groupText?: MeshcoreLateHopGroupText | null;
  /** Path-invariant payload id; a packet already seen on this connection changes no row. */
  payloadIdHex?: string | null;
}

export interface MeshcoreLateRfHopEnrichmentResult {
  storeId: string;
  previousRxHops: number | undefined;
  nextRxHops: number;
  /** True when a previously stored hop count was replaced (not first fill). */
  corrected: boolean;
}

type HopCorrectedListener = () => void;

const hopCorrectedUntilByStoreId = new Map<string, number>();
const hopCorrectedListeners = new Set<HopCorrectedListener>();
const hopCorrectedClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

function notifyHopCorrectedListeners(): void {
  for (const listener of hopCorrectedListeners) {
    try {
      listener();
    } catch (e) {
      console.warn(
        '[meshcoreLateRfHopEnrichment] hop-corrected listener failed ' + errLikeToLogString(e),
      );
    }
  }
}

/** Session-only mark: Chat briefly highlights the hop label after a late RF correction. */
export function markMeshcoreHopCorrected(
  storeId: string,
  now: number = Date.now(),
  ttlMs: number = MESHCORE_HOP_CORRECTED_UI_TTL_MS,
): void {
  if (!storeId) return;
  const until = now + ttlMs;
  hopCorrectedUntilByStoreId.set(storeId, until);
  const prior = hopCorrectedClearTimers.get(storeId);
  if (prior != null) clearTimeout(prior);
  hopCorrectedClearTimers.set(
    storeId,
    setTimeout(() => {
      hopCorrectedClearTimers.delete(storeId);
      const exp = hopCorrectedUntilByStoreId.get(storeId);
      if (exp != null && exp <= Date.now()) {
        hopCorrectedUntilByStoreId.delete(storeId);
        notifyHopCorrectedListeners();
      }
    }, ttlMs + 25),
  );
  notifyHopCorrectedListeners();
}

export function isMeshcoreHopCorrected(
  storeId: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!storeId) return false;
  const until = hopCorrectedUntilByStoreId.get(storeId);
  if (until == null) return false;
  if (until <= now) {
    hopCorrectedUntilByStoreId.delete(storeId);
    return false;
  }
  return true;
}

export function subscribeMeshcoreHopCorrected(listener: HopCorrectedListener): () => void {
  hopCorrectedListeners.add(listener);
  return () => {
    hopCorrectedListeners.delete(listener);
  };
}

/** Test helper — clears session correction marks. */
export function resetMeshcoreHopCorrectedMarksForTests(): void {
  for (const timer of hopCorrectedClearTimers.values()) clearTimeout(timer);
  hopCorrectedClearTimers.clear();
  hopCorrectedUntilByStoreId.clear();
  notifyHopCorrectedListeners();
}

/** Bound on remembered packet ids; repeats of one packet arrive within seconds. */
const MAX_SEEN_PACKET_KEYS = 512;
const seenPacketKeys: string[] = [];
const seenPacketKeySet = new Set<string>();

/** Records a packet's first reception on this connection; false when it was already seen. */
function markMeshcoreLateHopPacketSeen(identityId: IdentityId, payloadIdHex: string): boolean {
  const key = `${identityId}|${payloadIdHex.toUpperCase()}`;
  if (seenPacketKeySet.has(key)) return false;
  seenPacketKeySet.add(key);
  seenPacketKeys.push(key);
  while (seenPacketKeys.length > MAX_SEEN_PACKET_KEYS) {
    const old = seenPacketKeys.shift();
    if (old != null) seenPacketKeySet.delete(old);
  }
  return true;
}

/** Test helper: forgets which packets were already seen. */
export function resetMeshcoreLateHopSeenPacketsForTests(): void {
  seenPacketKeys.length = 0;
  seenPacketKeySet.clear();
}

/** Decrypt a GRP_TXT inner payload with the first configured channel key that opens it. */
export function decodeMeshcoreLateHopGroupText(
  innerPayload: Uint8Array,
  secretsByIndex: ReadonlyMap<number, Uint8Array>,
): MeshcoreLateHopGroupText | null {
  for (const [channel, secret] of secretsByIndex) {
    const decoded = decodeMeshcoreGroupText(secret, innerPayload);
    if (!decoded) continue;
    const rawText = sanitizeMeshcoreChatWireText(decoded.text);
    const normalized = normalizeMeshcoreIncomingText(rawText);
    return {
      channel,
      timestampSec: decoded.timestampSec,
      rawText,
      ...(normalized.senderName != null ? { senderName: normalized.senderName } : {}),
      payload: normalized.payload,
    };
  }
  return null;
}

/** Same channel, sender second and text as the stored row. */
function groupTextMatchesCandidate(
  c: MeshcoreLateHopCandidate,
  text: MeshcoreLateHopGroupText,
  now: number,
  windowMs: number,
): boolean {
  if (c.channel !== text.channel) return false;
  const sameText =
    (c.meshcoreDedupeKey != null && c.meshcoreDedupeKey === text.rawText) ||
    (c.sender_name === text.senderName && c.payload === text.payload);
  if (!sameText) return false;
  if (Math.floor(c.timestamp / 1000) === text.timestampSec) return true;
  // Rows store receive time when the sender's clock is missing or ahead.
  const wireMs = text.timestampSec * 1000;
  if (effectiveMessageTimestampMs(wireMs, now) === wireMs) return false;
  return Math.abs(now - c.timestamp) <= windowMs;
}

export function shouldApplyMeshcoreRfHopEnrichment(
  existingRxHops: number | undefined,
  rfHopCount: number,
  parseOk: boolean,
): boolean {
  if (!parseOk || !Number.isFinite(rfHopCount)) return false;
  const hops = Math.trunc(rfHopCount);
  if (hops < 0 || hops > 63) return false;
  if (existingRxHops == null) return true;
  return existingRxHops !== hops;
}

function isBroadcastChannelCandidate(c: MeshcoreLateHopCandidate): boolean {
  return c.channel >= 0 && c.roomServerId == null && c.channel !== MESHCORE_ROOM_MESSAGE_CHANNEL;
}

function isDmCandidate(c: MeshcoreLateHopCandidate): boolean {
  return c.channel === -1 && c.roomServerId == null;
}

function normalizeFingerprint(hex: string | null | undefined): string | null {
  if (typeof hex !== 'string') return null;
  const t = hex.trim();
  if (!/^[0-9A-Fa-f]{8}$/.test(t)) return null;
  return t.toUpperCase();
}

/**
 * Pick the chat row that late event 136 should enrich.
 * Prefer fingerprint match. A channel packet then needs a row with its decrypted content; a DM
 * (which cannot be decrypted here) takes its sender's most recent DM in the correlate window.
 */
export function findMeshcoreLateRfHopEnrichmentTarget(
  candidates: readonly MeshcoreLateHopCandidate[],
  input: MeshcoreLateRfHopEnrichmentInput,
): MeshcoreLateHopCandidate | undefined {
  if (!input.parseOk || !Number.isFinite(input.hopCount)) return undefined;
  const now = input.now ?? Date.now();
  const windowMs = input.windowMs ?? MESHCORE_CHAT_CORRELATE_WINDOW_MS;
  const myNodeNum = input.myNodeNum ?? 0;
  const rfHops = Math.trunc(input.hopCount);
  const fp = normalizeFingerprint(input.messageFingerprintHex);

  const applicable = (c: MeshcoreLateHopCandidate): boolean =>
    shouldApplyMeshcoreRfHopEnrichment(c.rxHops, rfHops, true);

  if (fp) {
    for (let i = candidates.length - 1; i >= 0; i--) {
      const c = candidates[i];
      if (normalizeFingerprint(c.rxPacketFingerprintHex) !== fp) continue;
      if (myNodeNum !== 0 && c.sender_id === myNodeNum) continue;
      if (!applicable(c)) continue;
      return c;
    }
  }

  const eligible = (c: MeshcoreLateHopCandidate): boolean => {
    if (myNodeNum !== 0 && c.sender_id === myNodeNum) return false;
    if (c.status === 'sending') return false;
    const via = c.receivedVia;
    return via == null || via === 'rf' || via === 'both' || via === 'mqtt';
  };

  if (input.payloadTypeString === 'GRP_TXT') {
    // Time proximity alone gave the previous message the next packet's count.
    const text = input.groupText;
    if (!text) return undefined;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const c = candidates[i];
      if (!isBroadcastChannelCandidate(c) || !eligible(c)) continue;
      if (!groupTextMatchesCandidate(c, text, now, windowMs)) continue;
      if (!applicable(c)) continue;
      return c;
    }
    return undefined;
  }

  // Same rule as ingest correlation (meshcoreRawPacketCorrelate): never another sender's row.
  const fromNodeId = input.fromNodeId;
  if (fromNodeId == null || fromNodeId === 0) return undefined;

  let best: MeshcoreLateHopCandidate | undefined;
  let bestTs = -Infinity;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    if (!isDmCandidate(c) || !eligible(c) || c.sender_id !== fromNodeId) continue;
    const tsMs = effectiveMessageTimestampMs(c.timestamp, now);
    if (Math.abs(now - tsMs) > windowMs) continue;
    if (!applicable(c)) continue;
    if (tsMs > bestTs) {
      best = c;
      bestTs = tsMs;
    }
  }

  return best;
}

function listLateHopCandidates(identityId: IdentityId): MeshcoreLateHopCandidate[] {
  const byId = useMessageStore.getState().messages[identityId] ?? {};
  const out: MeshcoreLateHopCandidate[] = [];
  for (const [storeId, record] of Object.entries(byId)) {
    const msg = messageRecordToChatMessage(record);
    out.push({
      storeId,
      sender_id: msg.sender_id,
      sender_name: msg.sender_name,
      payload: msg.payload,
      ...(msg.meshcoreDedupeKey != null ? { meshcoreDedupeKey: msg.meshcoreDedupeKey } : {}),
      channel: msg.channel,
      timestamp: msg.timestamp,
      ...(msg.rxHops != null ? { rxHops: msg.rxHops } : {}),
      ...(msg.receivedVia != null ? { receivedVia: msg.receivedVia } : {}),
      ...(msg.roomServerId != null ? { roomServerId: msg.roomServerId } : {}),
      ...(msg.rxPacketFingerprintHex != null
        ? { rxPacketFingerprintHex: msg.rxPacketFingerprintHex }
        : {}),
      ...(msg.status != null ? { status: msg.status } : {}),
    });
  }
  return out;
}

/**
 * Patch store + SQLite when late RF RX can fill or correct hops.
 * Returns null when nothing applied.
 */
export function applyMeshcoreLateRfHopEnrichment(
  identityId: IdentityId | null | undefined,
  input: MeshcoreLateRfHopEnrichmentInput,
): MeshcoreLateRfHopEnrichmentResult | null {
  if (!identityId) return null;
  if (!input.parseOk || !Number.isFinite(input.hopCount)) return null;
  // Repeats over other paths follow the first reception, which the radio's message already used.
  if (input.payloadIdHex && !markMeshcoreLateHopPacketSeen(identityId, input.payloadIdHex)) {
    return null;
  }

  const candidates = listLateHopCandidates(identityId);
  const target = findMeshcoreLateRfHopEnrichmentTarget(candidates, input);
  if (!target) return null;

  const nextRxHops = Math.trunc(input.hopCount);
  const previousRxHops = target.rxHops;
  const corrected = previousRxHops != null && previousRxHops !== nextRxHops;

  const byIdentity = useMessageStore.getState().messages[identityId];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
  if (!byIdentity) return null;
  const existing = byIdentity[target.storeId];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Message may be absent when race-deleted.
  if (!existing) return null;

  const nextReceivedVia =
    existing.receivedVia === 'mqtt' || existing.receivedVia === 'both'
      ? ('both' as const)
      : ('rf' as const);

  upsertMessage(identityId, {
    ...existing,
    id: target.storeId,
    rxHops: nextRxHops,
    hopCount: nextRxHops,
    receivedVia: nextReceivedVia,
  });

  const chat = messageRecordToChatMessage({
    ...existing,
    id: target.storeId,
    rxHops: nextRxHops,
    hopCount: nextRxHops,
    receivedVia: nextReceivedVia,
  });
  void window.electronAPI.db
    .saveMeshcoreMessage(messageToDbRow(chat, getConnection(identityId)?.myNodeNum))
    .catch((e: unknown) => {
      console.warn(
        '[meshcoreLateRfHopEnrichment] saveMeshcoreMessage failed ' + errLikeToLogString(e),
      );
    });

  if (corrected) {
    markMeshcoreHopCorrected(target.storeId, input.now ?? Date.now());
  }

  return {
    storeId: target.storeId,
    previousRxHops,
    nextRxHops,
    corrected,
  };
}

/** Stable UI key for hop-corrected marks (matches enrichment storeId when possible). */
export function meshcoreChatHopUiKey(msg: {
  storeId?: string;
  id?: number;
  sender_id: number;
  timestamp: number;
  channel: number;
}): string {
  if (msg.storeId) return msg.storeId;
  if (msg.id != null) return String(msg.id);
  return `${msg.sender_id}-${msg.timestamp}-${msg.channel}`;
}
