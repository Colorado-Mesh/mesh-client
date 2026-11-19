/**
 * Gate expensive Reticulum full refreshes / interface polls while the window is hidden
 * or another protocol is visible. Announce/peer patches stay at full rate elsewhere.
 */

import { getVisibleMeshProtocol } from '@/renderer/lib/visibleMeshProtocolStore';

/** Slow full refresh / poll cadence when Reticulum is not the visible protocol. */
export const RETICULUM_OFF_PROTOCOL_POLL_SCALE = 5;

/** Coalesce resume/become-visible refreshes into one trailing call. */
export const RETICULUM_BACKGROUND_RESUME_COALESCE_MS = 500;

/** Skip expensive background work while the document is hidden. */
export function shouldRunReticulumExpensiveBackgroundWork(): boolean {
  if (typeof document !== 'undefined' && document.hidden) return false;
  return true;
}

/**
 * Scale a base poll/refresh interval for off-protocol visibility.
 * Hidden windows still get a long delay so the timer can re-check after show.
 */
export function scaleReticulumBackgroundIntervalMs(baseMs: number): number {
  if (typeof document !== 'undefined' && document.hidden) {
    return baseMs * RETICULUM_OFF_PROTOCOL_POLL_SCALE;
  }
  const visible = getVisibleMeshProtocol();
  if (visible != null && visible !== 'reticulum') {
    return baseMs * RETICULUM_OFF_PROTOCOL_POLL_SCALE;
  }
  return baseMs;
}
