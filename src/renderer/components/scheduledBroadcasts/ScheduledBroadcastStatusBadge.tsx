import { useTranslation } from 'react-i18next';

import type { ScheduledBroadcastLastResult } from '@/shared/scheduledBroadcastTypes';

export function ScheduledBroadcastStatusBadge({
  result,
}: {
  result: ScheduledBroadcastLastResult | null | undefined;
}) {
  const { t } = useTranslation();
  if (!result) {
    return (
      <span className="text-ink-400 text-2xs" title={t('scheduledBroadcasts.never')}>
        {t('scheduledBroadcasts.never')}
      </span>
    );
  }
  const okCount = result.targets.filter((x) => x.ok).length;
  const total = result.targets.length;
  const label =
    result.outcome === 'partial'
      ? t('scheduledBroadcasts.status.partial', { ok: okCount, total })
      : t(`scheduledBroadcasts.status.${result.outcome}`);
  const title = result.targets
    .map((x) =>
      x.ok
        ? x.label
        : `${x.label}: ${x.reason ? t(`scheduledBroadcasts.reasons.${reasonKey(x.reason)}`) : ''}`,
    )
    .join('\n');
  const color =
    result.outcome === 'sent'
      ? 'bg-green-800 text-white'
      : result.outcome === 'partial' || result.outcome === 'missed' || result.outcome === 'skipped'
        ? 'bg-orange-800 text-white'
        : 'bg-red-800 text-white';
  return (
    <span className={`rounded-badge text-2xs px-1.5 py-0.5 ${color}`} title={title}>
      {label}
    </span>
  );
}

function reasonKey(reason: string): string {
  const map: Record<string, string> = {
    'not-connected': 'notConnected',
    'room-login-required': 'roomLoginRequired',
    'room-unknown': 'roomUnknown',
    'rrc-not-connected': 'rrcNotConnected',
    'text-too-long': 'textTooLong',
    'no-targets': 'noTargets',
    deferred: 'deferred',
    'send-failed': 'sendFailed',
    'empty-text': 'emptyText',
    'channel-missing': 'channelMissing',
  };
  return map[reason] ?? 'sendFailed';
}
