import type { TFunction } from 'i18next';

import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from '../../shared/timeConstants';

/** Sniffer-friendly relative time with second precision under one minute. */
export function formatRawPacketRelativeTime(ts: number, t: TFunction, nowMs = Date.now()): string {
  if (!ts) return t('common.never');
  const diff = nowMs - ts;
  if (diff < MS_PER_SECOND) return t('common.justNow');
  if (diff < MS_PER_MINUTE) {
    return t('common.secondsAgo', { count: Math.max(1, Math.floor(diff / MS_PER_SECOND)) });
  }
  if (diff < MS_PER_HOUR) {
    return t('common.minutesAgo', { count: Math.floor(diff / MS_PER_MINUTE) });
  }
  if (diff < 24 * MS_PER_HOUR) {
    return t('common.hoursAgo', { count: Math.floor(diff / MS_PER_HOUR) });
  }
  return t('common.daysAgo', { count: Math.floor(diff / (24 * MS_PER_HOUR)) });
}
