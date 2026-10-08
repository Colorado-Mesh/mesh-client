import { Siren } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { selectUnseenCriticalIncidents, useIncidentStore } from '@/renderer/stores/incidentStore';

import { MecpSeverityBadge } from '../mecp/MecpSeverityBadge';

/**
 * Standing alert for live MAYDAY/URGENT incidents nobody has looked at yet. Stays until the
 * operator opens the Incident tab, marks it seen, ACKs or resolves. Local only — never transmits.
 */
export function UnseenEmergencyBanner({ onView }: { onView: () => void }) {
  const { t, i18n } = useTranslation();
  const unseen = useIncidentStore(useShallow(selectUnseenCriticalIncidents));
  const current = unseen[0];
  if (!current) return null;

  const heardAt = new Date(current.receivedAt).toLocaleTimeString(i18n.language);
  const more = unseen.length - 1;

  return (
    <div
      role="alert"
      aria-label={t('incidentPanel.standingAlertRegion')}
      data-unseen-incident-id={current.id}
      className="flex shrink-0 items-center gap-3 border-b border-red-700 bg-red-900 px-4 py-2"
    >
      <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
        <span
          className="motion-status absolute inset-0 animate-pulse rounded-full bg-red-600"
          aria-hidden
        />
        <Siren aria-hidden className={`${ICON_MD} relative text-white`} />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <MecpSeverityBadge severity={current.severity} />
        <span className="text-sm font-semibold text-red-50">
          {t('incidentPanel.standingAlertTitle', { sender: current.senderName })}
        </span>
        <span className="text-sm text-red-100">
          {t('incidentPanel.standingAlertHeard', { time: heardAt })}
        </span>
        {more > 0 ? (
          <span className="text-sm text-red-100">
            {t('incidentPanel.standingAlertMore', { count: more })}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onView}
          aria-label={t('incidentPanel.standingAlertViewAria')}
          className="rounded-control bg-white px-2 py-1 text-xs font-semibold text-red-900 hover:bg-red-50"
        >
          {t('incidentPanel.standingAlertView')}
        </button>
        <button
          type="button"
          onClick={() => {
            useIncidentStore.getState().markSeen(current.id);
          }}
          aria-label={t('incidentPanel.standingAlertDismissAria', { sender: current.senderName })}
          className="rounded-control border border-red-300 px-2 py-1 text-xs font-medium text-red-50 hover:bg-red-800"
        >
          {t('incidentPanel.standingAlertDismiss')}
        </button>
      </div>
    </div>
  );
}
