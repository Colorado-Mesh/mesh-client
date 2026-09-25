import { useTranslation } from 'react-i18next';

import { type EmergencyIncident, useIncidentStore } from '@/renderer/stores/incidentStore';

export function ResolveIncidentButton({
  incident,
  transmitsBeaconCancel = false,
  onResolve,
}: {
  incident: EmergencyIncident;
  /** Originated active beacon: Resolve airs B03 before closing the row. */
  transmitsBeaconCancel?: boolean;
  onResolve?: (incident: EmergencyIncident) => void;
}) {
  const { t } = useTranslation();
  const resolveIncident = useIncidentStore((s) => s.resolveIncident);
  const labelKey = transmitsBeaconCancel ? 'incidentPanel.resolveBeacon' : 'incidentPanel.resolve';
  const ariaKey = transmitsBeaconCancel
    ? 'incidentPanel.resolveBeaconAria'
    : 'incidentPanel.resolveAria';
  return (
    <button
      type="button"
      aria-label={t(ariaKey, { sender: incident.senderName })}
      onClick={() => {
        if (onResolve) onResolve(incident);
        else resolveIncident(incident.id);
      }}
      className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-600"
    >
      {t(labelKey)}
    </button>
  );
}
