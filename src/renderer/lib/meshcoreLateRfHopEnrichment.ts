/**
 * Late event-136 → chat-row hop enrichment.
 *
 * When companion events 7/8 ingest before raw RF RX (136), or companion pathLen is
 * missing/wrong, patch the matching chat row from a successful RF parse. RF on-air
 * path length is authoritative when it disagrees with a stored hop count.
 */
import {
  MESHCORE_ROOM_MESSAGE_CHANNEL,
  messageToDbRow,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { upsertMessage, useMessageStore } from '../stores/messageStore';
import { errLikeToLogString } from './errLikeToLogString';
import { MESHCORE_CHAT_CORRELATE_WINDOW_MS } from './meshcoreRawPacketCorrelate';
import { effectiveMessageTimestampMs } from './nodeStatus';
import { messageRecordToChatMessage } from './storeRecordAdapters';
import type { ChatMessage, IdentityId } from './types';

/** How long the Chat hop label shows the “refined from RF” accent after a correction. */
export const MESHCORE_HOP_CORRECTED_UI_TTL_MS = 2000;

export interface MeshcoreLateHopCandidate {
  storeId: string;
  sender_id: number;
  channel: number;
  timestamp: number;
  rxHops?: number;
  receivedVia?: ChatMessage['receivedVia'];
  roomServerId?: number;
  rxPacketFingerprintHex?: string;
  status?: ChatMessage['status'];
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
 * Prefer fingerprint match; else most recent matching channel/DM in the correlate window.
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

  const kindOk =
    input.payloadTypeString === 'GRP_TXT' ? isBroadcastChannelCandidate : isDmCandidate;

  let best: MeshcoreLateHopCandidate | undefined;
  let bestTs = -Infinity;
  let bestFromMatch = false;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    if (!kindOk(c)) continue;
    if (myNodeNum !== 0 && c.sender_id === myNodeNum) continue;
    if (c.status === 'sending') continue;
    const via = c.receivedVia;
    if (via != null && via !== 'rf' && via !== 'both' && via !== 'mqtt') continue;
    const tsMs = effectiveMessageTimestampMs(c.timestamp, now);
    if (Math.abs(now - tsMs) > windowMs) continue;
    if (!applicable(c)) continue;

    const fromMatch =
      input.payloadTypeString === 'TXT_MSG' &&
      input.fromNodeId != null &&
      c.sender_id === input.fromNodeId;

    if (!best || (fromMatch && !bestFromMatch) || (fromMatch === bestFromMatch && tsMs > bestTs)) {
      best = c;
      bestTs = tsMs;
      bestFromMatch = fromMatch;
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
  void window.electronAPI.db.saveMeshcoreMessage(messageToDbRow(chat)).catch((e: unknown) => {
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
