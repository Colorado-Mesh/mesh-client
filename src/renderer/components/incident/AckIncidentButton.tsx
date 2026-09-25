import { useTranslation } from 'react-i18next';

import type { EmergencyIncident } from '@/renderer/stores/incidentStore';

/** Sending is owned by the caller (protocol-specific); this only renders the control. */
export function AckIncidentButton({
  incident,
  onAck,
  disabled,
}: {
  incident: EmergencyIncident;
  onAck: (incident: EmergencyIncident) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const beacon = incident.beaconActive && !incident.beaconAcked;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={t(beacon ? 'incidentPanel.ackBeaconAria' : 'incidentPanel.ackAria', {
        sender: incident.senderName,
      })}
      onClick={() => {
        onAck(incident);
      }}
      className="rounded bg-blue-700 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {t(beacon ? 'incidentPanel.ackBeacon' : 'incidentPanel.ack')}
    </button>
  );
}
