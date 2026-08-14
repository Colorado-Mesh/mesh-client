/**
 * Header queue badge color classes.
 * Meshtastic/MeshCore use absolute used-slot thresholds (radio queue ~16).
 * Reticulum uses fill ratio (host TX mpsc often 256).
 */

export type QueueBadgeColorMode = 'absolute' | 'ratio';

export const QUEUE_BADGE_GREEN = 'bg-green-900/60 text-green-300 border border-green-700';
export const QUEUE_BADGE_AMBER = 'bg-amber-900/60 text-amber-300 border border-amber-700';
export const QUEUE_BADGE_RED = 'bg-red-900/60 text-red-300 border border-red-700';

/** Absolute used slots (Meshtastic ~16 maxlen; MeshCore reuses same thresholds). */
export function queueBadgeColorClassAbsolute(used: number): string {
  if (used <= 10) return QUEUE_BADGE_GREEN;
  if (used <= 14) return QUEUE_BADGE_AMBER;
  return QUEUE_BADGE_RED;
}

/** Fill ratio for large host queues (Reticulum). */
export function queueBadgeColorClassRatio(used: number, max: number): string {
  if (max <= 0) return QUEUE_BADGE_GREEN;
  const ratio = used / max;
  if (ratio < 0.25) return QUEUE_BADGE_GREEN;
  if (ratio < 0.6) return QUEUE_BADGE_AMBER;
  return QUEUE_BADGE_RED;
}

export function queueBadgeColorClass(used: number, max: number, mode: QueueBadgeColorMode): string {
  return mode === 'ratio'
    ? queueBadgeColorClassRatio(used, max)
    : queueBadgeColorClassAbsolute(used);
}
