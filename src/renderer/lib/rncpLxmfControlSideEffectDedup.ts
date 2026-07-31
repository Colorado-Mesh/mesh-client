import { computeReticulumMessageHash } from '@/renderer/lib/reticulum/messageHash';
import { RNCP_REQUEST_ENABLE_COOLDOWN_MS } from '@/shared/rncpRequestEnable';
import { MS_PER_HOUR } from '@/shared/timeConstants';

/** How long a handled LXMF control message_hash blocks re-firing side effects. */
export const RNCP_LXMF_CONTROL_HANDLED_TTL_MS = 2 * MS_PER_HOUR;

/** Cap in-memory handled hashes (catch-up can be chatty on large meshes). */
const HANDLED_CAP = 500;

/** Cap peer auto-share cooldown entries (long-lived clients on large meshes). */
const ALREADY_ENABLED_PEER_CAP = 500;

export interface RncpLxmfControlHandledReservation {
  key: string;
  token: number;
}

export interface RncpAlreadyEnabledAutoShareReservation {
  key: string;
  token: number;
}

interface DedupEntry {
  at: number;
  token: number;
  /** false while in-flight; true after a terminal outcome. */
  committed: boolean;
}

const handledAtByHash = new Map<string, DedupEntry>();
const alreadyEnabledShareAtByPeer = new Map<string, DedupEntry>();
let handledTokenSeq = 1;
let peerTokenSeq = 1;

function normalizeMessageHash(messageHash: string): string | null {
  const key = messageHash.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return key.length >= 16 ? key : null;
}

function normalizePeer(peerLxmfHash: string): string | null {
  const key = peerLxmfHash.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return key.length === 32 ? key : null;
}

function pruneMapByTtlAndCap(
  map: Map<string, DedupEntry>,
  now: number,
  ttlMs: number,
  cap: number,
): void {
  for (const [hash, entry] of map) {
    if (now - entry.at > ttlMs) {
      map.delete(hash);
    }
  }
  while (map.size > cap) {
    let oldestKey: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [hash, entry] of map) {
      if (entry.at < oldestAt) {
        oldestAt = entry.at;
        oldestKey = hash;
      }
    }
    if (oldestKey == null) break;
    map.delete(oldestKey);
  }
}

function pruneHandled(now: number): void {
  pruneMapByTtlAndCap(handledAtByHash, now, RNCP_LXMF_CONTROL_HANDLED_TTL_MS, HANDLED_CAP);
}

function pruneAlreadyEnabledPeers(now: number): void {
  pruneMapByTtlAndCap(
    alreadyEnabledShareAtByPeer,
    now,
    RNCP_REQUEST_ENABLE_COOLDOWN_MS,
    ALREADY_ENABLED_PEER_CAP,
  );
}

/**
 * Resolve a stable id for RNCP LXMF control side effects (enable-request / dest-share).
 * Prefers wire `message_hash`; otherwise matches ingest's FNV fallback.
 */
export function resolveRncpLxmfControlMessageHash(opts: {
  message_hash?: string | null;
  sender_hash?: string | null;
  timestamp?: number | null;
  text?: string | null;
}): string | null {
  const wire = opts.message_hash?.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (wire && wire.length >= 16) return wire;
  const sender = opts.sender_hash?.replace(/[^0-9a-f]/gi, '').toLowerCase() ?? '';
  const text = opts.text ?? '';
  const ts = opts.timestamp;
  if (!sender || typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  return computeReticulumMessageHash(sender, ts, text);
}

/**
 * Reserve a control message for side effects. Catch-up / WS duplicates return null
 * while a reservation or committed entry is still within TTL.
 * Commit after a terminal outcome; release on recoverable failure so retry can proceed.
 */
export function tryReserveRncpLxmfControlHandled(
  messageHash: string,
  now = Date.now(),
): RncpLxmfControlHandledReservation | null {
  const key = normalizeMessageHash(messageHash);
  if (!key) return null;
  pruneHandled(now);
  const prev = handledAtByHash.get(key);
  if (prev != null && now - prev.at <= RNCP_LXMF_CONTROL_HANDLED_TTL_MS) {
    return null;
  }
  const token = handledTokenSeq++;
  handledAtByHash.set(key, { at: now, token, committed: false });
  return { key, token };
}

/** Persist a reservation after success or a terminal invalid outcome. */
export function commitRncpLxmfControlHandled(
  reservation: RncpLxmfControlHandledReservation,
  now = Date.now(),
): void {
  const entry = handledAtByHash.get(reservation.key);
  if (entry?.token !== reservation.token) return;
  entry.committed = true;
  entry.at = now;
}

/**
 * Drop an in-flight reservation after a recoverable failure.
 * No-ops when a newer reservation already replaced this token.
 */
export function releaseRncpLxmfControlHandled(
  reservation: RncpLxmfControlHandledReservation,
): void {
  const entry = handledAtByHash.get(reservation.key);
  if (entry?.token !== reservation.token) return;
  handledAtByHash.delete(reservation.key);
}

/**
 * Atomically reserve+commit (enable-request enqueue path — side effect is sync).
 * Returns true the first time this control message should fire UI/network side effects.
 */
export function tryMarkRncpLxmfControlHandled(messageHash: string, now = Date.now()): boolean {
  const reservation = tryReserveRncpLxmfControlHandled(messageHash, now);
  if (!reservation) return false;
  commitRncpLxmfControlHandled(reservation, now);
  return true;
}

/**
 * Reserve the already-listening auto-share cooldown slot for a peer.
 * Commit after an LXMF dest-share is sent; release when nothing was sent so retry can proceed.
 */
export function tryReserveRncpAlreadyEnabledAutoShareSlot(
  peerLxmfHash: string,
  now = Date.now(),
): RncpAlreadyEnabledAutoShareReservation | null {
  const key = normalizePeer(peerLxmfHash);
  if (!key) return null;
  pruneAlreadyEnabledPeers(now);
  const prev = alreadyEnabledShareAtByPeer.get(key);
  if (prev != null && now - prev.at < RNCP_REQUEST_ENABLE_COOLDOWN_MS) {
    return null;
  }
  const token = peerTokenSeq++;
  alreadyEnabledShareAtByPeer.set(key, { at: now, token, committed: false });
  return { key, token };
}

export function commitRncpAlreadyEnabledAutoShareSlot(
  reservation: RncpAlreadyEnabledAutoShareReservation,
  now = Date.now(),
): void {
  const entry = alreadyEnabledShareAtByPeer.get(reservation.key);
  if (entry?.token !== reservation.token) return;
  entry.committed = true;
  entry.at = now;
}

export function releaseRncpAlreadyEnabledAutoShareSlot(
  reservation: RncpAlreadyEnabledAutoShareReservation,
): void {
  const entry = alreadyEnabledShareAtByPeer.get(reservation.key);
  if (entry?.token !== reservation.token) return;
  alreadyEnabledShareAtByPeer.delete(reservation.key);
}

/**
 * Already-listening auto-share: at most one outbound dest-share per peer per
 * request-enable cooldown window (belt-and-suspenders vs message_hash dedup).
 * Prefer reserve/commit/release when the share is async.
 */
export function tryConsumeRncpAlreadyEnabledAutoShareSlot(
  peerLxmfHash: string,
  now = Date.now(),
): boolean {
  const reservation = tryReserveRncpAlreadyEnabledAutoShareSlot(peerLxmfHash, now);
  if (!reservation) return false;
  commitRncpAlreadyEnabledAutoShareSlot(reservation, now);
  return true;
}

/** Test helper. */
export function resetRncpLxmfControlSideEffectDedupForTests(): void {
  handledAtByHash.clear();
  alreadyEnabledShareAtByPeer.clear();
  handledTokenSeq = 1;
  peerTokenSeq = 1;
}
