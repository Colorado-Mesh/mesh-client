import { useTranslation } from 'react-i18next';

import type { ReticulumInterfaceIssueAlert } from '@/shared/reticulum-types';

export interface ReticulumSidecarIssueAlertsBlockProps {
  alert: ReticulumInterfaceIssueAlert;
  /** When true, hint that other Reticulum apps may conflict via shared instance. */
  shareInstanceEnabled?: boolean;
}

function countSidecarIssues(alert: ReticulumInterfaceIssueAlert): number {
  return (
    alert.tcpConnectFailed.length +
    alert.txQueueDrops.length +
    alert.linkDeliveryTimeouts.length +
    (alert.transportSaturatedCount > 0 ? 1 : 0) +
    (alert.slowTransportQueryCount > 0 ? 1 : 0)
  );
}

/** Sidecar stderr/stdout issues: unreachable TCP hubs, TX queue drops, and transport health. */
export function ReticulumSidecarIssueAlertsBlock({
  alert,
  shareInstanceEnabled = false,
}: ReticulumSidecarIssueAlertsBlockProps) {
  const { t } = useTranslation();
  const issueCount = countSidecarIssues(alert);
  if (issueCount === 0) {
    return null;
  }

  const showShareInstanceHint =
    shareInstanceEnabled &&
    (alert.linkDeliveryTimeouts.length > 0 ||
      alert.transportSaturatedCount > 0 ||
      alert.txQueueDrops.length > 0);

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
        {alert.linkDeliveryTimeouts.map(({ destinationHash, count }) => (
          <li key={`link-${destinationHash}`}>
            <p>
              {t('connectionPanel.reticulumSidecarIssues.linkDeliveryTimeout', {
                hash: destinationHash.slice(0, 8),
                count,
              })}
            </p>
            <p className="text-muted mt-0.5 text-[11px]">
              {t('connectionPanel.reticulumSidecarIssues.linkDeliveryTimeoutHint')}
            </p>
          </li>
        ))}
        {alert.transportSaturatedCount > 0 ? (
          <li key="transport-saturated">
            <p>
              {t('connectionPanel.reticulumSidecarIssues.transportSaturated', {
                count: alert.transportSaturatedCount,
              })}
            </p>
            <p className="text-muted mt-0.5 text-[11px]">
              {t('connectionPanel.reticulumSidecarIssues.transportSaturatedHint')}
            </p>
          </li>
        ) : null}
        {alert.slowTransportQueryCount > 0 ? (
          <li key="slow-transport">
            <p>
              {t('connectionPanel.reticulumSidecarIssues.slowTransportQuery', {
                count: alert.slowTransportQueryCount,
              })}
            </p>
            <p className="text-muted mt-0.5 text-[11px]">
              {t('connectionPanel.reticulumSidecarIssues.slowTransportQueryHint')}
            </p>
          </li>
        ) : null}
      </ul>
      {showShareInstanceHint ? (
        <p className="text-muted mt-2 text-[11px]">
          {t('connectionPanel.reticulumSidecarIssues.shareInstanceHint')}
        </p>
      ) : null}
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
