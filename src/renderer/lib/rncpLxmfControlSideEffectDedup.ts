import { computeReticulumMessageHash } from '@/renderer/lib/reticulum/messageHash';
import { RNCP_REQUEST_ENABLE_COOLDOWN_MS } from '@/shared/rncpRequestEnable';
import { MS_PER_HOUR } from '@/shared/timeConstants';

/** How long a handled LXMF control message_hash blocks re-firing side effects. */
export const RNCP_LXMF_CONTROL_HANDLED_TTL_MS = 2 * MS_PER_HOUR;

/** Cap in-memory handled hashes (catch-up can be chatty on large meshes). */
const HANDLED_CAP = 500;

const handledAtByHash = new Map<string, number>();
const alreadyEnabledShareAtByPeer = new Map<string, number>();

function normalizeMessageHash(messageHash: string): string | null {
  const key = messageHash.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return key.length >= 16 ? key : null;
}

function normalizePeer(peerLxmfHash: string): string | null {
  const key = peerLxmfHash.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return key.length === 32 ? key : null;
}

function pruneHandled(now: number): void {
  for (const [hash, at] of handledAtByHash) {
    if (now - at > RNCP_LXMF_CONTROL_HANDLED_TTL_MS) {
      handledAtByHash.delete(hash);
    }
  }
  while (handledAtByHash.size > HANDLED_CAP) {
    const oldest = handledAtByHash.keys().next().value;
    if (oldest == null) break;
    handledAtByHash.delete(oldest);
  }
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
 * Returns true the first time this control message should fire UI/network side effects.
 * Catch-up / WS duplicates return false so enable-modals and dest-share apply do not re-run.
 */
export function tryMarkRncpLxmfControlHandled(messageHash: string, now = Date.now()): boolean {
  const key = normalizeMessageHash(messageHash);
  if (!key) return false;
  pruneHandled(now);
  const prev = handledAtByHash.get(key);
  if (prev != null && now - prev <= RNCP_LXMF_CONTROL_HANDLED_TTL_MS) {
    return false;
  }
  handledAtByHash.set(key, now);
  return true;
}

/**
 * Already-listening auto-share: at most one outbound dest-share per peer per
 * request-enable cooldown window (belt-and-suspenders vs message_hash dedup).
 */
export function tryConsumeRncpAlreadyEnabledAutoShareSlot(
  peerLxmfHash: string,
  now = Date.now(),
): boolean {
  const key = normalizePeer(peerLxmfHash);
  if (!key) return false;
  const prev = alreadyEnabledShareAtByPeer.get(key);
  if (prev != null && now - prev < RNCP_REQUEST_ENABLE_COOLDOWN_MS) {
    return false;
  }
  alreadyEnabledShareAtByPeer.set(key, now);
  return true;
}

/** Test helper. */
export function resetRncpLxmfControlSideEffectDedupForTests(): void {
  handledAtByHash.clear();
  alreadyEnabledShareAtByPeer.clear();
}
