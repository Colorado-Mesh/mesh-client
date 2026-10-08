import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { blockMecpIncidentSender, incidentOriginProtocol } from '@/renderer/lib/mecp/mecpBlock';
import { PROTOCOL_THEME } from '@/renderer/lib/protocolTheme';
import type { EmergencyIncident } from '@/renderer/stores/incidentStore';

import { ConfirmModal } from '../ConfirmModal';
import { useToast } from '../Toast';

/** Block MECP alerts from an incident's sender (local only; asks first). */
export function BlockIncidentSenderButton({ incident }: { incident: EmergencyIncident }) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  if (incident.localOrigin === true) return null;

  const finish = (resolveOpen: boolean) => {
    setConfirming(false);
    blockMecpIncidentSender(incident, { resolveOpen });
    addToast(t('mecp.block.blocked', { sender: incident.senderName }), 'success');
  };

  return (
    <>
      <button
        type="button"
        className="border-ink-600 text-ink-300 rounded border px-2 py-0.5 text-xs hover:border-red-700 hover:text-red-300"
        aria-label={t('mecp.block.blockActionAria', { sender: incident.senderName })}
        onClick={() => {
          setConfirming(true);
        }}
      >
        {t('mecp.block.blockAction')}
      </button>
      {confirming ? (
        <ConfirmModal
          title={t('mecp.block.confirmTitle', { sender: incident.senderName })}
          message={t('mecp.block.confirmMessage', {
            protocol: PROTOCOL_THEME[incidentOriginProtocol(incident)].displayName,
          })}
          confirmLabel={t('mecp.block.confirmBlockAndResolve')}
          altActionLabel={t('mecp.block.confirmBlock')}
          danger
          onAltAction={() => {
            finish(false);
          }}
          onConfirm={() => {
            finish(true);
          }}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      ) : null}
    </>
  );
}
