import { useTranslation } from 'react-i18next';

import type { NodeStatus } from '@/renderer/lib/nodeStatus';

const DOT_CLASS: Record<NodeStatus, string> = {
  online: 'bg-green-500',
  stale: 'bg-orange-500',
  offline: 'bg-ink-500',
};

export function TeamPresenceDot({
  status,
  className = '',
}: {
  status: NodeStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const label =
    status === 'online'
      ? t('teamRoster.presenceOnline')
      : status === 'stale'
        ? t('teamRoster.presenceStale')
        : t('teamRoster.presenceOffline');
  return (
    <span
      role="img"
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[status]} ${className}`}
      title={label}
      aria-label={label}
    />
  );
}
