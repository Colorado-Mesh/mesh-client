import type { TFunction } from 'i18next';

import { formatIsoDate, formatIsoDateTime } from '../../shared/formatIsoDate';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../../shared/timeConstants';

/** Relative i18n until 24h, then YYYY-MM-DD (local wall time). */
export function formatRelativeOrIsoDate(
  ts: number,
  t: TFunction,
  normalize: (value: number) => number = (value) => value,
): string {
  if (!ts) return t('common.never');
  const normalizedTs = normalize(ts);
  const diff = Date.now() - normalizedTs;
  if (diff < MS_PER_MINUTE) return t('common.justNow');
  if (diff < MS_PER_HOUR) {
    return t('common.minutesAgo', { count: Math.floor(diff / MS_PER_MINUTE) });
  }
  if (diff < MS_PER_DAY) {
    return t('common.hoursAgo', { count: Math.floor(diff / MS_PER_HOUR) });
  }
  return formatIsoDate(normalizedTs);
}

/** Relative i18n until 24h, then YYYY-MM-DD HH:mm (local wall time). */
export function formatRelativeOrIsoDateTime(
  ts: number,
  t: TFunction,
  normalize: (value: number) => number = (value) => value,
): string {
  if (!ts) return t('common.never');
  const normalizedTs = normalize(ts);
  const diff = Date.now() - normalizedTs;
  if (diff < MS_PER_MINUTE) return t('common.justNow');
  if (diff < MS_PER_HOUR) {
    return t('common.minutesAgo', { count: Math.floor(diff / MS_PER_MINUTE) });
  }
  if (diff < MS_PER_DAY) {
    return t('common.hoursAgo', { count: Math.floor(diff / MS_PER_HOUR) });
  }
  return formatIsoDateTime(normalizedTs);
}
