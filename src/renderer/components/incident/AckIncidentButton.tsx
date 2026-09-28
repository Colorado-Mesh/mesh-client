import { useTranslation } from 'react-i18next';

import type { EmergencyIncident } from '@/renderer/stores/incidentStore';

import { buttonClassName } from '../ui/Button';

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
      className={buttonClassName('primary', 'sm')}
    >
      {t(beacon ? 'incidentPanel.ackBeacon' : 'incidentPanel.ack')}
    </button>
  );
}
