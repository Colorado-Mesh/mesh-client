import { useTranslation } from 'react-i18next';

import type { ReticulumLocalInterfaceAlert } from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { reticulumLocalOfflineDisplayKind } from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';

function alertNeedsSerialPortContext(alert: ReticulumLocalInterfaceAlert): boolean {
  if (alert.reason === 'stale_port') {
    return true;
  }
  return (
    alert.reason === 'enabled_down' && reticulumLocalOfflineDisplayKind(alert.iface) === 'serial'
  );
}

export interface ReticulumLocalInterfaceAlertsBlockProps {
  alerts: ReticulumLocalInterfaceAlert[];
  availablePorts: string[];
  /** Interface display names with CoreBluetooth "Peer removed pairing information". */
  bleBondRemovedNames?: readonly string[];
  onRefreshPorts?: () => void;
  onRestartStack?: () => void | Promise<void>;
  compact?: boolean;
}

function ifaceHasBleBondRemoved(
  ifaceName: string,
  bleBondRemovedNames: readonly string[] | undefined,
): boolean {
  if (!bleBondRemovedNames || bleBondRemovedNames.length === 0) return false;
  return bleBondRemovedNames.some((n) => n === ifaceName);
}

/** User-visible summary when local/USB Reticulum interfaces need attention. */
export function ReticulumLocalInterfaceAlertsBlock({
  alerts,
  availablePorts,
  bleBondRemovedNames,
  onRefreshPorts,
  onRestartStack,
  compact = false,
}: ReticulumLocalInterfaceAlertsBlockProps) {
  const { t } = useTranslation();

  if (alerts.length === 0) {
    return null;
  }

  const showSerialPortContext = alerts.some(alertNeedsSerialPortContext);

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-600/50 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-100"
    >
      <p className="font-medium text-amber-200">
        {t('connectionPanel.reticulumLocalInterfaces.needsAttention', { count: alerts.length })}
      </p>
      <ul className="mt-2 space-y-2 text-xs text-amber-100/90">
        {alerts.map((alert) => (
          <li key={alert.iface.id}>
            <p>
              {alert.reason === 'stale_port'
                ? t('connectionPanel.reticulumLocalInterfaces.stalePort', {
                    name: alert.iface.name,
                    port: alert.iface.serial_port ?? '',
                  })
                : alert.reason === 'tcp_unreachable'
                  ? t('connectionPanel.reticulumLocalInterfaces.tcpUnreachable', {
                      name: alert.iface.name,
                      host: alert.iface.host ?? '',
                      port: alert.iface.port ?? '',
                    })
                  : t('connectionPanel.reticulumLocalInterfaces.offline', {
                      name: alert.iface.name,
                    })}
            </p>
            {!compact ? (
              <p className="text-muted mt-0.5 text-[11px]">
                {alert.reason === 'stale_port'
                  ? t('connectionPanel.reticulumLocalInterfaces.stalePortHint')
                  : alert.reason === 'tcp_unreachable'
                    ? t('connectionPanel.reticulumLocalInterfaces.tcpUnreachableHint')
                    : (() => {
                        const kind = reticulumLocalOfflineDisplayKind(alert.iface);
                        if (kind === 'ble') {
                          if (ifaceHasBleBondRemoved(alert.iface.name, bleBondRemovedNames)) {
                            return t(
                              'connectionPanel.reticulumLocalInterfaces.offlineHintBleBondStale',
                            );
                          }
                          return t('connectionPanel.reticulumLocalInterfaces.offlineHintBle');
                        }
                        if (kind === 'wifi') {
                          return t('connectionPanel.reticulumLocalInterfaces.offlineHintWifi');
                        }
                        return t('connectionPanel.reticulumLocalInterfaces.offlineHint');
                      })()}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {showSerialPortContext && availablePorts.length > 0 ? (
        <p className="text-muted mt-2 text-[11px]">
          {t('connectionPanel.reticulumLocalInterfaces.availablePorts', {
            ports: availablePorts.join(', '),
          })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {onRestartStack ? (
          <button
            type="button"
            onClick={() => {
              void onRestartStack();
            }}
            className="rounded bg-amber-700/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600"
            aria-label={t('connectionPanel.reticulumLocalInterfaces.restartStackAria')}
          >
            {t('connectionPanel.reticulumLocalInterfaces.restartStack')}
          </button>
        ) : null}
        {onRefreshPorts && showSerialPortContext ? (
          <button
            type="button"
            onClick={onRefreshPorts}
            className="rounded border border-amber-600/60 px-2.5 py-1 text-xs text-amber-100 hover:bg-amber-900/40"
            aria-label={t('connectionPanel.reticulumLocalInterfaces.refreshPorts')}
          >
            {t('connectionPanel.reticulumLocalInterfaces.refreshPorts')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
