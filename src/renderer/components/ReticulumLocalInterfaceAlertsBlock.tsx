import { useTranslation } from 'react-i18next';

import type { ReticulumLocalInterfaceAlert } from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';

export interface ReticulumLocalInterfaceAlertsBlockProps {
  alerts: ReticulumLocalInterfaceAlert[];
  availablePorts: string[];
  onOpenRadio?: () => void;
  onRefreshPorts?: () => void;
  compact?: boolean;
}

/** User-visible summary when local/USB Reticulum interfaces need attention. */
export function ReticulumLocalInterfaceAlertsBlock({
  alerts,
  availablePorts,
  onOpenRadio,
  onRefreshPorts,
  compact = false,
}: ReticulumLocalInterfaceAlertsBlockProps) {
  const { t } = useTranslation();

  if (alerts.length === 0) {
    return null;
  }

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
                : t('connectionPanel.reticulumLocalInterfaces.offline', {
                    name: alert.iface.name,
                  })}
            </p>
            {!compact ? (
              <p className="text-muted mt-0.5 text-[11px]">
                {alert.reason === 'stale_port'
                  ? t('connectionPanel.reticulumLocalInterfaces.stalePortHint')
                  : t('connectionPanel.reticulumLocalInterfaces.offlineHint')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {availablePorts.length > 0 ? (
        <p className="text-muted mt-2 text-[11px]">
          {t('connectionPanel.reticulumLocalInterfaces.availablePorts', {
            ports: availablePorts.join(', '),
          })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {onOpenRadio ? (
          <button
            type="button"
            onClick={onOpenRadio}
            className="rounded bg-amber-700/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600"
            aria-label={t('connectionPanel.reticulumLocalInterfaces.openRadio')}
          >
            {t('connectionPanel.reticulumLocalInterfaces.openRadio')}
          </button>
        ) : null}
        {onRefreshPorts ? (
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
