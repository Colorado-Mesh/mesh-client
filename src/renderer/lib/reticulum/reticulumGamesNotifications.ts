import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '@/renderer/lib/chatInactiveNotifications';
import { playMessageNotification } from '@/renderer/lib/chatNotifications';
import { isGamesSessionInitiator } from '@/renderer/lib/reticulum/reticulumGamesMetadata';

/** App sets this so runtime can suppress challenge pings while Games is focused. */
let gamesTabFocused = false;

export function setReticulumGamesTabFocused(focused: boolean): void {
  gamesTabFocused = focused;
}

export function isReticulumGamesTabFocused(): boolean {
  return gamesTabFocused;
}

export function totalGamesUnread(sessions: readonly { unread: number }[]): number {
  let sum = 0;
  for (const row of sessions) {
    const n = row.unread;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      sum += Math.floor(n);
    }
  }
  return sum;
}

/**
 * True when a `games.update` payload is an inbound pending challenge for the
 * local player (not the session initiator).
 */
export function shouldNotifyInboundGamesChallenge(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (p.direction !== 'inbound') return false;
  const session = p.session;
  if (!session || typeof session !== 'object') return false;
  const s = session as Record<string, unknown>;
  if (s.status !== 'pending') return false;
  if (typeof s.initiator !== 'string' || typeof s.identity_id !== 'string') return false;
  if (isGamesSessionInitiator({ initiator: s.initiator, identity_id: s.identity_id })) {
    return false;
  }
  return true;
}

/** Play a DM-style ping for inbound challenges when Games is not focused/visible. */
export function maybeNotifyInboundGamesChallenge(payload: unknown): void {
  if (!shouldNotifyInboundGamesChallenge(payload)) return;
  if (
    typeof localStorage !== 'undefined' &&
    localStorage.getItem(CHAT_NOTIF_MUTED_STORAGE_KEY) === '1'
  ) {
    return;
  }
  if (isReticulumGamesTabFocused() && typeof document !== 'undefined' && !document.hidden) {
    return;
  }
  playMessageNotification('dm');
}
