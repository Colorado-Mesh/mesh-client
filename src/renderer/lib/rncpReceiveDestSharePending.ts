import { MS_PER_MINUTE } from '@/shared/timeConstants';

/** How long an outbound request-enable authorizes ingest of a peer's receive-dest share. */
export const RNCP_RECEIVE_DEST_SHARE_PENDING_TTL_MS = 30 * MS_PER_MINUTE;

const pendingByPeer = new Map<string, number>();

function normalizePeer(peerLxmfHash: string): string | null {
  const key = peerLxmfHash.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return key.length === 32 ? key : null;
}

/** Record that we asked this peer to enable rncp receive (authorizes dest-share ingest). */
export function markRncpReceiveDestSharePending(peerLxmfHash: string, now = Date.now()): void {
  const key = normalizePeer(peerLxmfHash);
  if (!key) return;
  pendingByPeer.set(key, now);
}

/**
 * True if we recently sent request-enable to this peer. Consumes the pending
 * slot so a planted share after TTL or without a prior request is ignored.
 */
export function consumeRncpReceiveDestSharePending(
  peerLxmfHash: string,
  now = Date.now(),
): boolean {
  const key = normalizePeer(peerLxmfHash);
  if (!key) return false;
  const at = pendingByPeer.get(key);
  if (at == null) return false;
  pendingByPeer.delete(key);
  return now - at <= RNCP_RECEIVE_DEST_SHARE_PENDING_TTL_MS;
}

/** Whether a share from this peer would be accepted without consuming. */
export function hasRncpReceiveDestSharePending(peerLxmfHash: string, now = Date.now()): boolean {
  const key = normalizePeer(peerLxmfHash);
  if (!key) return false;
  const at = pendingByPeer.get(key);
  if (at == null) return false;
  if (now - at > RNCP_RECEIVE_DEST_SHARE_PENDING_TTL_MS) {
    pendingByPeer.delete(key);
    return false;
  }
  return true;
}

/** Test helper. */
export function resetRncpReceiveDestSharePendingForTests(): void {
  pendingByPeer.clear();
}
