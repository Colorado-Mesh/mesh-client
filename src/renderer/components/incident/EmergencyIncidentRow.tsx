import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  notifyChatOutboxRowsChanged,
  subscribeChatOutboxRowsChanged,
} from '@/renderer/lib/chatOutboxDrain';
import { parseIncidentAckViewKey } from '@/renderer/lib/mecp/incidentAck';
import type { EmergencyIncident } from '@/renderer/stores/incidentStore';
import type { OutboxEntry } from '@/shared/electron-api.types';
import { isMeshProtocol, REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

import { MecpSeverityBadge } from '../mecp/MecpSeverityBadge';
import { AckIncidentButton } from './AckIncidentButton';
import { ResolveIncidentButton } from './ResolveIncidentButton';

export function EmergencyIncidentRow({
  incident,
  onAck,
  onResolve,
  transmitsBeaconCancel = false,
  pendingAckRows = [],
  onCancelPendingAck,
}: {
  incident: EmergencyIncident;
  onAck?: (incident: EmergencyIncident) => void;
  onResolve?: (incident: EmergencyIncident) => void;
  /** Show Cancel beacon when resolving will transmit B03. */
  transmitsBeaconCancel?: boolean;
  /** Queued / failed ACK outbox rows tagged for this incident (not visible in Chat). */
  pendingAckRows?: readonly OutboxEntry[];
  onCancelPendingAck?: (row: OutboxEntry) => void;
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
        {pendingAckRows.length > 0 ? (
          <span className="text-xs text-sky-300">{t('incidentPanel.ackQueuedBadge')}</span>
        ) : null}
      </div>
      {incident.freetext ? <p className="text-xs text-gray-200">{incident.freetext}</p> : null}
      {pendingAckRows.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label={t('incidentPanel.pendingAckListAria')}>
          {pendingAckRows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-2 rounded border border-slate-600 bg-slate-900/60 px-2 py-1 text-xs text-gray-300"
            >
              <span className="truncate font-mono">{row.payload}</span>
              <span className="text-gray-400">{row.status}</span>
              {onCancelPendingAck ? (
                <button
                  type="button"
                  className="ml-auto rounded border border-slate-500 px-1.5 py-0.5 text-gray-200 hover:bg-slate-700"
                  aria-label={t('incidentPanel.cancelPendingAckAria', {
                    sender: incident.senderName,
                  })}
                  onClick={() => {
                    onCancelPendingAck(row);
                  }}
                >
                  {t('incidentPanel.cancelPendingAck')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
        <span>{t('incidentPanel.ackCount', { count: incident.ackCount })}</span>
        <span>
          {t('incidentPanel.protocolsSeen', { protocols: incident.protocolsSeen.join(', ') })}
        </span>
        <span className="ml-auto flex gap-2">
          {onAck ? <AckIncidentButton incident={incident} onAck={onAck} /> : null}
          <ResolveIncidentButton
            incident={incident}
            transmitsBeaconCancel={transmitsBeaconCancel}
            onResolve={onResolve}
          />
        </span>
      </div>
    </li>
  );
}

async function listIncidentAckOutboxRows(): Promise<OutboxEntry[]> {
  const lists = await Promise.all(
    REGISTERED_MESH_PROTOCOLS.map((p) => window.electronAPI.chat.outbox.list(p)),
  );
  return lists.flat().filter((r) => parseIncidentAckViewKey(r.viewKey) != null);
}

/** Load ACK outbox rows across protocols for Incident Command (not shown in Chat views). */
export function useIncidentAckOutboxRows(): {
  rowsByIncidentId: Map<string, OutboxEntry[]>;
  cancelAck: (row: OutboxEntry) => Promise<void>;
} {
  const [rows, setRows] = useState<OutboxEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void listIncidentAckOutboxRows()
        .then((listed) => {
          if (!cancelled) setRows(listed);
        })
        .catch((err: unknown) => {
          console.warn('[IncidentPanel] list ACK outbox failed', err);
        });
    };
    load();
    const unsubs = REGISTERED_MESH_PROTOCOLS.map((p) =>
      subscribeChatOutboxRowsChanged(p, () => {
        load();
      }),
    );
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, []);

  const cancelAck = useCallback(async (row: OutboxEntry) => {
    try {
      await window.electronAPI.chat.outbox.remove(row.id);
      if (isMeshProtocol(row.protocol)) notifyChatOutboxRowsChanged(row.protocol);
    } catch (err: unknown) {
      console.warn('[IncidentPanel] cancel ACK outbox failed', err);
    }
  }, []);

  const rowsByIncidentId = new Map<string, OutboxEntry[]>();
  for (const row of rows) {
    const id = parseIncidentAckViewKey(row.viewKey);
    if (id == null) continue;
    const list = rowsByIncidentId.get(id) ?? [];
    list.push(row);
    rowsByIncidentId.set(id, list);
  }

  return { rowsByIncidentId, cancelAck };
}
