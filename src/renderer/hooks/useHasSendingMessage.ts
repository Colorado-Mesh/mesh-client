import type { IdentityId } from '../lib/types';
import { useMessageStore } from '../stores/messageStore';

/**
 * True when the identity has a local `sending` row. Re-renders only when the boolean flips.
 */
export function useHasSendingMessage(
  identityId: IdentityId | null,
  myNodeNum: number,
  enabled: boolean,
): boolean {
  return useMessageStore((s) => {
    if (!enabled || !identityId) return false;
    const bucket = s.messages[identityId];
    if (!bucket) return false;
    for (const m of Object.values(bucket)) {
      if (m.status !== 'sending') continue;
      if (myNodeNum > 0 && m.from !== myNodeNum) continue;
      return true;
    }
    return false;
  });
}

/**
 * True when a local `sending` row is still within `windowMs` of now.
 * `nowMs` should come from a ticking clock (e.g. useNowMs) while sending is active.
 */
export function useHasLocalSendingMessage(
  identityId: IdentityId | null,
  myNodeNum: number,
  nowMs: number,
  windowMs: number,
  enabled: boolean,
): boolean {
  return useMessageStore((s) => {
    if (!enabled || !identityId || nowMs <= 0) return false;
    const bucket = s.messages[identityId];
    if (!bucket) return false;
    for (const m of Object.values(bucket)) {
      if (m.status !== 'sending') continue;
      if (myNodeNum > 0 && m.from !== myNodeNum) continue;
      if (nowMs - m.timestamp > windowMs) continue;
      return true;
    }
    return false;
  });
}
