import { RNCP_REQUEST_ENABLE_COOLDOWN_MS } from '@/shared/rncpRequestEnable';

const lastSentByPeer = new Map<string, number>();

/** Returns true if a request may be sent now (and records the attempt). */
export function tryConsumeRncpRequestEnableSlot(peerLxmfHash: string, now = Date.now()): boolean {
  const key = peerLxmfHash.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(key)) return false;
  const prev = lastSentByPeer.get(key);
  if (prev != null && now - prev < RNCP_REQUEST_ENABLE_COOLDOWN_MS) {
    return false;
  }
  lastSentByPeer.set(key, now);
  return true;
}

/** Test helper. */
export function resetRncpRequestEnableRateLimitForTests(): void {
  lastSentByPeer.clear();
}
