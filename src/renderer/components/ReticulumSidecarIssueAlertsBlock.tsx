import { useTranslation } from 'react-i18next';

import {
  resolveReticulumTxDropHintKind,
  type ReticulumLocalInterfaceInput,
  reticulumTxDropConnectionHintKey,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import type { ReticulumInterfaceIssueAlert } from '@/shared/reticulum-types';

export interface ReticulumSidecarIssueAlertsBlockProps {
  alert: ReticulumInterfaceIssueAlert;
  /** When true, hint that other Reticulum apps may conflict via shared instance. */
  shareInstanceEnabled?: boolean;
  /** Local interface rows for transport-aware TX-drop hints. */
  interfaces?: readonly Pick<
    ReticulumLocalInterfaceInput,
    'name' | 'type' | 'serial_port' | 'flow_control'
  >[];
  onStopStack?: () => void | Promise<void>;
  onOpenAdminBluetooth?: () => void;
}

/** Stack-health issues for Connection; per-peer link timeouts stay in Diagnostics/Chat. */
function countSidecarInterfaceIssues(alert: ReticulumInterfaceIssueAlert): number {
  return (
    alert.tcpConnectFailed.length +
    alert.txQueueDrops.length +
    (alert.bleBondRemoved?.length ?? 0) +
    (alert.blePairingTimedOut?.length ?? 0) +
    (alert.transportSaturatedCount > 0 ? 1 : 0) +
    (alert.slowTransportQueryCount > 0 ? 1 : 0)
  );
}

/** Sidecar stderr/stdout issues: unreachable TCP hubs, TX queue drops, and transport health. */
export function ReticulumSidecarIssueAlertsBlock({
  alert,
  shareInstanceEnabled = false,
  interfaces,
  onStopStack,
  onOpenAdminBluetooth,
}: ReticulumSidecarIssueAlertsBlockProps) {
  const { t } = useTranslation();
  const issueCount = countSidecarInterfaceIssues(alert);
  if (issueCount === 0) {
    return null;
  }

  const showShareInstanceHint =
    shareInstanceEnabled && (alert.transportSaturatedCount > 0 || alert.txQueueDrops.length > 0);
  const bleBondRemoved = alert.bleBondRemoved ?? [];
  const blePairingTimedOut = alert.blePairingTimedOut ?? [];
  const showBleBondActions =
    bleBondRemoved.length > 0 && (onStopStack != null || onOpenAdminBluetooth != null);

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
        {alert.txQueueDrops.map(({ name, dropCount }) => {
          const hintKind = resolveReticulumTxDropHintKind(name, interfaces, bleBondRemoved);
          const hintKey = reticulumTxDropConnectionHintKey(hintKind);
          let hintText: string;
          switch (hintKey) {
            case 'txQueueDropsHintBleBondStale':
              hintText = t('connectionPanel.reticulumSidecarIssues.txQueueDropsHintBleBondStale');
              break;
            case 'txQueueDropsHintBleFlowControl':
              hintText = t('connectionPanel.reticulumSidecarIssues.txQueueDropsHintBleFlowControl');
              break;
            case 'txQueueDropsHintBle':
              hintText = t('connectionPanel.reticulumSidecarIssues.txQueueDropsHintBle');
              break;
            case 'txQueueDropsHintNeutral':
              hintText = t('connectionPanel.reticulumSidecarIssues.txQueueDropsHintNeutral');
              break;
            case 'txQueueDropsHint':
            default:
              hintText = t('connectionPanel.reticulumSidecarIssues.txQueueDropsHint');
              break;
          }
          return (
            <li key={`tx-${name}`}>
              <p>
                {t('connectionPanel.reticulumSidecarIssues.txQueueDrops', {
                  name,
                  count: dropCount,
                })}
              </p>
              <p className="text-muted mt-0.5 text-[11px]">{hintText}</p>
            </li>
          );
        })}
        {bleBondRemoved.map((name) => (
          <li key={`ble-bond-${name}`}>
            <p>{t('connectionPanel.reticulumSidecarIssues.bleBondRemoved', { name })}</p>
            <p className="text-muted mt-0.5 text-[11px]">
              {t('connectionPanel.reticulumSidecarIssues.bleBondRemovedHint')}
            </p>
          </li>
        ))}
        {showBleBondActions ? (
          <li className="flex flex-wrap gap-2 pt-1">
            {onStopStack ? (
              <button
                type="button"
                className="rounded border border-red-500/50 bg-red-950/50 px-2 py-1 text-[11px] text-red-100 hover:bg-red-900/40"
                aria-label={t('connectionPanel.reticulumSidecarIssues.bleBondRemovedStopStack')}
                onClick={() => {
                  void Promise.resolve(onStopStack()).catch((e: unknown) => {
                    console.warn(
                      '[ReticulumSidecarIssueAlertsBlock] stop stack failed ' +
                        (e instanceof Error ? e.message : String(e)),
                    );
                  });
                }}
              >
                {t('connectionPanel.reticulumSidecarIssues.bleBondRemovedStopStack')}
              </button>
            ) : null}
            {onOpenAdminBluetooth ? (
              <button
                type="button"
                className="rounded border border-amber-600/50 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-900/40"
                aria-label={t('connectionPanel.reticulumSidecarIssues.bleBondRemovedOpenAdmin')}
                onClick={() => {
                  onOpenAdminBluetooth();
                }}
              >
                {t('connectionPanel.reticulumSidecarIssues.bleBondRemovedOpenAdmin')}
              </button>
            ) : null}
          </li>
        ) : null}
        {blePairingTimedOut.map((name) => (
          <li key={`ble-pair-timeout-${name}`}>
            <p>{t('connectionPanel.reticulumSidecarIssues.blePairingTimedOut', { name })}</p>
            <p className="text-muted mt-0.5 text-[11px]">
              {t('connectionPanel.reticulumSidecarIssues.blePairingTimedOutHint')}
            </p>
          </li>
        ))}
        {alert.transportSaturatedCount > 0 ? (
          <li>
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
          <li>
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
        {showShareInstanceHint ? (
          <li>
            <p className="text-muted text-[11px]">
              {t('connectionPanel.reticulumSidecarIssues.shareInstanceHint')}
            </p>
          </li>
        ) : null}
        {(alert.suppressedCount ?? 0) > 0 ? (
          <li>
            <p className="text-muted text-[11px]">
              {t('connectionPanel.reticulumSidecarIssues.suppressed', {
                count: alert.suppressedCount,
              })}
            </p>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
