import { useTranslation } from 'react-i18next';

import type { ReticulumDmPathStatus } from '@/renderer/lib/reticulum/reticulumDmPathReachability';

import { HelpTooltip } from './HelpTooltip';

export function ReticulumDmPathReachabilityBadge({
  status,
  hops,
}: {
  status: ReticulumDmPathStatus;
  hops: number | null;
}) {
  const { t } = useTranslation();
  if (status === 'idle') return null;

  const label =
    status === 'probing'
      ? t('chatPanel.dmPathChecking')
      : status === 'reachable'
        ? hops != null
          ? t('chatPanel.dmPathReachableHops', { hops })
          : t('chatPanel.dmPathReachable')
        : t('chatPanel.dmPathUnreachable');

  const tooltip =
    status === 'unreachable'
      ? t('chatPanel.dmPathUnreachableTooltip')
      : status === 'reachable'
        ? t('chatPanel.dmPathReachableTooltip')
        : t('chatPanel.dmPathCheckingTooltip');

  const ariaLabel =
    status === 'probing'
      ? t('chatPanel.dmPathCheckingAria')
      : status === 'reachable'
        ? t('chatPanel.dmPathReachableAria')
        : t('chatPanel.dmPathUnreachableAria');

  const textClass =
    status === 'probing'
      ? 'text-muted'
      : status === 'reachable'
        ? 'text-bright-green'
        : 'text-red-400';

  return (
    <HelpTooltip text={tooltip} className="shrink-0" ariaLabel={ariaLabel}>
      <span
        role="status"
        aria-label={ariaLabel}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs ${textClass}`}
      >
        {status === 'probing' ? (
          <span
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent"
            aria-hidden
          />
        ) : (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              status === 'reachable' ? 'bg-bright-green' : 'bg-red-500'
            }`}
            aria-hidden
          />
        )}
        <span aria-hidden>{label}</span>
      </span>
    </HelpTooltip>
  );
}
