import { type ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal } from '@/renderer/components/ConfirmModal';
import { useToast } from '@/renderer/components/Toast';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { classifyMeshClientDeepLink } from '@/shared/meshClientDeepLink';

interface PendingLxmContact {
  destinationHash: string;
  name: string | null;
}

/**
 * Mount once from App: listen for lxm:// / OS deep links and route actions.
 * External contact imports require explicit confirmation.
 */
export function MeshClientDeepLinkHost(): ReactElement | null {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [pendingContact, setPendingContact] = useState<PendingLxmContact | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    const api = window.electronAPI?.deepLink;
    if (!api?.onOpenUrl) return undefined;

    const unsub = api.onOpenUrl((url) => {
      const parsed = classifyMeshClientDeepLink(url);
      if (parsed.kind === 'lxmPaperUnsupported') {
        addToast(t('qrIngest.paperUnsupported'), 'error');
        return;
      }
      if (parsed.kind === 'lxmContact') {
        setPendingContact({
          destinationHash: parsed.destinationHash,
          name: parsed.name ?? null,
        });
        return;
      }
      if (parsed.kind === 'lxmIdentity') {
        addToast(t('qrIngest.identityShown'), 'success');
        return;
      }
      if (parsed.kind === 'meshtasticChannel') {
        window.dispatchEvent(
          new CustomEvent('mesh-client:meshtasticChannelUrl', { detail: parsed.url }),
        );
        addToast(t('qrIngest.channelLinkReceived'), 'success');
        return;
      }
      addToast(t('qrIngest.unknownLink'), 'error');
    });

    return unsub;
  }, [addToast, t]);

  const confirmImport = async () => {
    if (!pendingContact || importBusy) return;
    setImportBusy(true);
    try {
      await window.electronAPI.db.upsertReticulumDestination({
        destination_hash: pendingContact.destinationHash,
        display_name: pendingContact.name,
        // reticulum_destinations.last_heard is Unix seconds (retention prune).
        last_heard: Math.floor(Date.now() / 1000),
      });
      addToast(t('qrIngest.contactImported'), 'success');
      setPendingContact(null);
    } catch (err) {
      console.error('[MeshClientDeepLinkHost] contact upsert failed: ' + errLikeToLogString(err));
      addToast(t('qrIngest.contactImportFailed'), 'error');
    } finally {
      setImportBusy(false);
    }
  };

  if (!pendingContact) return null;

  const label = pendingContact.name ?? pendingContact.destinationHash.slice(0, 12);
  return (
    <ConfirmModal
      title={t('qrIngest.confirmContactImportTitle')}
      message={t('qrIngest.confirmContactImportBody', { name: label })}
      confirmLabel={t('qrIngest.confirmContactImportAction')}
      confirmDisabled={importBusy}
      onCancel={() => {
        if (!importBusy) setPendingContact(null);
      }}
      onConfirm={() => {
        void confirmImport();
      }}
    />
  );
}
