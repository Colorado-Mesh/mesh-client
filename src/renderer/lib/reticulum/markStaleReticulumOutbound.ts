import type { IdentityId } from '@/renderer/lib/types';
import { updateMessageStatus, useMessageStore } from '@/renderer/stores/messageStore';
import { MS_PER_HOUR } from '@/shared/timeConstants';

/** Outbound LXMF messages older than this without delivery are marked failed on startup. */
export const RETICULUM_STALE_OUTBOUND_MS = 24 * MS_PER_HOUR;

/**
 * Mark stale outbound Reticulum messages as failed in SQLite.
 * Failure point: DB IPC unavailable — logs and returns count 0.
 */
export async function markStaleReticulumOutboundMessages(
  identityId: string,
  staleAfterMs: number = RETICULUM_STALE_OUTBOUND_MS,
): Promise<number> {
  try {
    const res = await window.electronAPI.db.markStaleReticulumOutbound(identityId, staleAfterMs);
    return res?.changes ?? 0;
  } catch {
    // catch-no-log-ok DB IPC unavailable on startup — caller treats as zero changes
    return 0;
  }
}

/** Mark in-memory sending messages older than threshold as failed. */
export function markStaleReticulumOutboundInStore(
  identityId: IdentityId,
  staleAfterMs: number = RETICULUM_STALE_OUTBOUND_MS,
): number {
  const cutoff = Date.now() - staleAfterMs;
  const bucket = useMessageStore.getState().messages[identityId] ?? {};
  let count = 0;
  for (const msg of Object.values(bucket)) {
    if (msg.status === 'sending' && msg.timestamp < cutoff) {
      updateMessageStatus(identityId, msg.id, 'failed');
      count += 1;
    }
  }
  return count;
}
