import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from './timeConstants';

/** Propagation auto-sync interval options (seconds). `0` = disabled. */
export const RETICULUM_PROPAGATION_AUTO_SYNC_INTERVALS_SEC = [
  0,
  (15 * MS_PER_MINUTE) / MS_PER_SECOND,
  (30 * MS_PER_MINUTE) / MS_PER_SECOND,
  MS_PER_HOUR / MS_PER_SECOND,
  (3 * MS_PER_HOUR) / MS_PER_SECOND,
  (6 * MS_PER_HOUR) / MS_PER_SECOND,
  (12 * MS_PER_HOUR) / MS_PER_SECOND,
  (24 * MS_PER_HOUR) / MS_PER_SECOND,
] as const;

export type ReticulumPropagationAutoSyncIntervalSec =
  (typeof RETICULUM_PROPAGATION_AUTO_SYNC_INTERVALS_SEC)[number];

/** Default background propagation sync interval: every hour. */
export const RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC = MS_PER_HOUR / MS_PER_SECOND;

export function isReticulumPropagationAutoSyncIntervalSec(
  value: number,
): value is ReticulumPropagationAutoSyncIntervalSec {
  return (RETICULUM_PROPAGATION_AUTO_SYNC_INTERVALS_SEC as readonly number[]).includes(value);
}

export function reticulumPropagationAutoSyncOptionKey(sec: number): string {
  switch (sec) {
    case 0:
      return 'reticulumPropagation.autoSyncOptionDisabled';
    case 900:
      return 'reticulumPropagation.autoSyncOption15m';
    case 1800:
      return 'reticulumPropagation.autoSyncOption30m';
    case 10800:
      return 'reticulumPropagation.autoSyncOption3h';
    case 21600:
      return 'reticulumPropagation.autoSyncOption6h';
    case 43200:
      return 'reticulumPropagation.autoSyncOption12h';
    case 86400:
      return 'reticulumPropagation.autoSyncOption24h';
    default:
      return 'reticulumPropagation.autoSyncOption1h';
  }
}
