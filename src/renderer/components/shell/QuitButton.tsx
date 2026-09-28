import { LogOut } from 'lucide-react-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import {
  gatherQuitRisks,
  quitMeshClient,
  quitNeedsConfirm,
  type QuitRisks,
} from '@/renderer/lib/quitMeshClient';
import { selectAnyLinkUp, useConnectionStore } from '@/renderer/stores/connectionStore';

import { ConfirmModal } from '../ConfirmModal';

/**
 * Header Disconnect & Quit, so leaving the app does not mean a trip to Device > Connection. Red and
 * last in the header at the maintainer's request. It quits in one click when nothing would be cut
 * off, and asks first while a link is up, a MAYDAY or URGENT incident is open, or an emergency
 * message is still waiting to send.
 */
export function QuitButton() {
  const { t } = useTranslation();
  const linkUp = useConnectionStore(selectAnyLinkUp);
  const [risks, setRisks] = useState<QuitRisks | null>(null);
  const label = t(linkUp ? 'connectionPanel.disconnectAndQuit' : 'connectionPanel.quit');

  const handleClick = async () => {
    const found = await gatherQuitRisks(linkUp);
    if (quitNeedsConfirm(found)) setRisks(found);
    else await quitMeshClient(false);
  };

  const confirmMessage = (r: QuitRisks) =>
    [
      r.openEmergencies > 0 && t('shell.quitConfirmIncidents', { n: r.openEmergencies }),
      r.pendingEmergencyMessages > 0 &&
        t('shell.quitConfirmOutbox', { n: r.pendingEmergencyMessages }),
      r.linkUp && t('shell.quitConfirmLinks'),
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void handleClick();
        }}
        aria-label={label}
        title={label}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-400 transition-colors hover:bg-red-950/40 hover:text-red-300"
      >
        <LogOut aria-hidden className={ICON_MD} size={16} />
      </button>
      {risks && (
        <ConfirmModal
          title={t('shell.quitConfirmTitle')}
          message={confirmMessage(risks)}
          confirmLabel={t(
            risks.linkUp ? 'connectionPanel.disconnectAndQuit' : 'connectionPanel.quit',
          )}
          danger
          onConfirm={() => {
            const disconnect = risks.linkUp;
            setRisks(null);
            void quitMeshClient(disconnect);
          }}
          onCancel={() => {
            setRisks(null);
          }}
        />
      )}
    </>
  );
}
