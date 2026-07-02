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

const AUTO_SYNC_OPTION_KEYS: Record<ReticulumPropagationAutoSyncIntervalSec, string> = {
  0: 'reticulumPropagation.autoSyncOptionDisabled',
  900: 'reticulumPropagation.autoSyncOption15m',
  1800: 'reticulumPropagation.autoSyncOption30m',
  3600: 'reticulumPropagation.autoSyncOption1h',
  10800: 'reticulumPropagation.autoSyncOption3h',
  21600: 'reticulumPropagation.autoSyncOption6h',
  43200: 'reticulumPropagation.autoSyncOption12h',
  86400: 'reticulumPropagation.autoSyncOption24h',
};

export function reticulumPropagationAutoSyncOptionKey(sec: number): string {
  if (isReticulumPropagationAutoSyncIntervalSec(sec)) {
    return AUTO_SYNC_OPTION_KEYS[sec];
  }
  return AUTO_SYNC_OPTION_KEYS[RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC];
}
