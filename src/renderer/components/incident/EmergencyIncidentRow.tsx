import { useTranslation } from 'react-i18next';

import type { EmergencyIncident } from '@/renderer/stores/incidentStore';

import { MecpSeverityBadge } from '../mecp/MecpSeverityBadge';
import { AckIncidentButton } from './AckIncidentButton';
import { ResolveIncidentButton } from './ResolveIncidentButton';

export function EmergencyIncidentRow({
  incident,
  onAck,
}: {
  incident: EmergencyIncident;
  onAck?: (incident: EmergencyIncident) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-1 rounded border border-slate-700 bg-slate-800 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <MecpSeverityBadge severity={incident.severity} />
        <span className="text-sm font-semibold text-gray-100">{incident.senderName}</span>
        <span className="font-mono text-xs text-gray-300">{incident.codes.join(' ')}</span>
        {incident.isDrill ? (
          <span className="text-xs text-gray-300">{t('incidentPanel.drill')}</span>
        ) : null}
        {incident.beaconActive ? (
          <span className="text-xs text-amber-300">{t('incidentPanel.beaconActive')}</span>
        ) : null}
      </div>
      {incident.freetext ? <p className="text-xs text-gray-200">{incident.freetext}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
        <span>{t('incidentPanel.ackCount', { count: incident.ackCount })}</span>
        <span>
          {t('incidentPanel.protocolsSeen', { protocols: incident.protocolsSeen.join(', ') })}
        </span>
        <span className="ml-auto flex gap-2">
          {onAck ? <AckIncidentButton incident={incident} onAck={onAck} /> : null}
          <ResolveIncidentButton incidentId={incident.id} senderName={incident.senderName} />
        </span>
      </div>
    </li>
  );
}
