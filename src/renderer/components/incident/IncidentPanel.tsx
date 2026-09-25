import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type EmergencyIncident,
  selectOpenIncidentsSorted,
  useIncidentStore,
} from '@/renderer/stores/incidentStore';

import { EmergencyIncidentRow, useIncidentAckOutboxRows } from './EmergencyIncidentRow';

export interface IncidentPanelProps {
  onAck?: (incident: EmergencyIncident) => void;
}

export default function IncidentPanel({ onAck }: IncidentPanelProps) {
  const { t } = useTranslation();
  const incidents = useIncidentStore((s) => s.incidents);
  const open = useMemo(() => selectOpenIncidentsSorted({ incidents }), [incidents]);
  const { rowsByIncidentId, cancelAck } = useIncidentAckOutboxRows();

  return (
    <section aria-labelledby="incident-panel-title" className="flex flex-col gap-2 p-3">
      <h2 id="incident-panel-title" className="text-base font-semibold text-gray-100">
        {t('incidentPanel.title')}
      </h2>
      <p className="max-w-prose text-sm text-gray-300">{t('incidentPanel.intro')}</p>
      {open.length === 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-gray-300">{t('incidentPanel.empty')}</p>
          <p className="max-w-prose text-xs text-gray-400">{t('incidentPanel.emptyHint')}</p>
        </div>
      ) : (
        <ul aria-label={t('incidentPanel.listAria')} className="flex flex-col gap-2">
          {open.map((inc) => (
            <EmergencyIncidentRow
              key={inc.id}
              incident={inc}
              onAck={onAck}
              pendingAckRows={rowsByIncidentId.get(inc.id) ?? []}
              onCancelPendingAck={(row) => {
                void cancelAck(row);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
