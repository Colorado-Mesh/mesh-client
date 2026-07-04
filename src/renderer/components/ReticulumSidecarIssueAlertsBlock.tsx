import { useTranslation } from 'react-i18next';

import type { ReticulumInterfaceIssueAlert } from '@/shared/reticulum-types';

export interface ReticulumSidecarIssueAlertsBlockProps {
  alert: ReticulumInterfaceIssueAlert;
}

/** Sidecar stderr/stdout issues: unreachable TCP hubs and TX queue drops. */
export function ReticulumSidecarIssueAlertsBlock({ alert }: ReticulumSidecarIssueAlertsBlockProps) {
  const { t } = useTranslation();
  const issueCount = alert.tcpConnectFailed.length + alert.txQueueDrops.length;
  if (issueCount === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      className="rounded-lg border border-red-600/50 bg-red-950/30 px-3 py-2.5 text-sm text-red-100"
    >
      <p className="font-medium text-red-200">
        {t('connectionPanel.reticulumSidecarIssues.heading', { count: issueCount })}
      </p>
      <ul className="mt-2 space-y-2 text-xs text-red-100/90">
        {alert.tcpConnectFailed.map((name) => (
          <li key={`tcp-${name}`}>
            <p>{t('connectionPanel.reticulumSidecarIssues.tcpConnectFailed', { name })}</p>
            <p className="text-muted mt-0.5 text-[11px]">
              {t('connectionPanel.reticulumSidecarIssues.tcpConnectFailedHint')}
            </p>
          </li>
        ))}
        {alert.txQueueDrops.map(({ name, dropCount }) => (
          <li key={`tx-${name}`}>
            <p>
              {t('connectionPanel.reticulumSidecarIssues.txQueueDrops', {
                name,
                count: dropCount,
              })}
            </p>
            <p className="text-muted mt-0.5 text-[11px]">
              {t('connectionPanel.reticulumSidecarIssues.txQueueDropsHint')}
            </p>
          </li>
        ))}
      </ul>
      {alert.suppressedCount > 0 ? (
        <p className="text-muted mt-2 text-[11px]">
          {t('connectionPanel.reticulumSidecarIssues.suppressed', {
            count: alert.suppressedCount,
          })}
        </p>
      ) : null}
    </div>
  );
}
