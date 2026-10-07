import { Download } from 'lucide-react-motion';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { downloadBlob } from '@/renderer/lib/downloadBlob';
import {
  incidentsToCsv,
  incidentsToExportRows,
  incidentsToJson,
} from '@/renderer/lib/exportFormats';
import { ICON_SM_PLUS } from '@/renderer/lib/icons/iconClass';
import { shouldTransmitBeaconCancel } from '@/renderer/lib/mecp/beaconCancel';
import {
  type EmergencyIncident,
  selectOpenIncidentsSorted,
  useIncidentStore,
} from '@/renderer/stores/incidentStore';

import { LabeledMenuButton } from '../ui/Menu';
import { EmergencyIncidentRow, useIncidentAckOutboxRows } from './EmergencyIncidentRow';

const EMPTY_OWN_SENDER_IDS: ReadonlySet<string> = new Set();

function incidentExportFilename(ext: 'json' | 'csv'): string {
  return `mesh-incidents-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export interface IncidentPanelProps {
  onAck?: (incident: EmergencyIncident) => void;
  onResolve?: (incident: EmergencyIncident) => void;
  /** Local node ids (decimal strings) used to recognize beacons this station originated. */
  ownSenderIds?: ReadonlySet<string>;
}

export default function IncidentPanel({
  onAck,
  onResolve,
  ownSenderIds = EMPTY_OWN_SENDER_IDS,
}: IncidentPanelProps) {
  const { t } = useTranslation();
  const incidents = useIncidentStore((s) => s.incidents);
  const open = useMemo(() => selectOpenIncidentsSorted({ incidents }), [incidents]);
  const { rowsByIncidentId, cancelAck } = useIncidentAckOutboxRows();
  const hasAnyIncident = Object.keys(incidents).length > 0;

  const exportJson = () => {
    const payload = incidentsToJson(incidentsToExportRows(Object.values(incidents)));
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      incidentExportFilename('json'),
    );
  };
  const exportCsv = () => {
    downloadBlob(
      new Blob([incidentsToCsv(incidentsToExportRows(Object.values(incidents)))], {
        type: 'text/csv',
      }),
      incidentExportFilename('csv'),
    );
  };

  return (
    <section aria-labelledby="incident-panel-title" className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="incident-panel-title" className="text-ink-100 text-base font-semibold">
          {t('incidentPanel.title')}
        </h2>
        <LabeledMenuButton
          size="sm"
          label={t('incidentPanel.exportLog')}
          icon={<Download aria-hidden className={ICON_SM_PLUS} size={14} />}
          menuLabel={t('incidentPanel.exportMenuLabel')}
          disabled={!hasAnyIncident}
          entries={[
            { id: 'json', label: t('incidentPanel.exportJson'), onSelect: exportJson },
            { id: 'csv', label: t('incidentPanel.exportCsv'), onSelect: exportCsv },
          ]}
        />
      </div>
      <p className="text-ink-300 max-w-prose text-sm">{t('incidentPanel.intro')}</p>
      {open.length === 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-ink-300 text-sm">{t('incidentPanel.empty')}</p>
          <p className="text-ink-400 max-w-prose text-xs">{t('incidentPanel.emptyHint')}</p>
        </div>
      ) : (
        <ul aria-label={t('incidentPanel.listAria')} className="flex flex-col gap-2">
          {open.map((inc) => (
            <EmergencyIncidentRow
              key={inc.id}
              incident={inc}
              onAck={onAck}
              onResolve={onResolve}
              transmitsBeaconCancel={
                onResolve != null && shouldTransmitBeaconCancel(inc, ownSenderIds)
              }
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
