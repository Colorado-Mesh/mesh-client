import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { classifyMeshClientDeepLink } from '@/shared/meshClientDeepLink';

/**
 * Mount once from App: listen for lxm:// / OS deep links and route contact upserts.
 */
export function useMeshClientDeepLink(): void {
  const { t } = useTranslation();
  const { addToast } = useToast();

  useEffect(() => {
    const api = window.electronAPI?.deepLink;
    if (!api?.onOpenUrl) return undefined;

    const unsub = api.onOpenUrl((url) => {
      void (async () => {
        const parsed = classifyMeshClientDeepLink(url);
        if (parsed.kind === 'lxmPaperUnsupported') {
          addToast(t('qrIngest.paperUnsupported'), 'error');
          return;
        }
        if (parsed.kind === 'lxmContact') {
          try {
            await window.electronAPI.db.upsertReticulumDestination({
              destination_hash: parsed.destinationHash,
              display_name: parsed.name ?? null,
              last_heard: Date.now(),
            });
            addToast(t('qrIngest.contactImported'), 'success');
          } catch (err) {
            console.error(
              '[useMeshClientDeepLink] contact upsert failed: ' + errLikeToLogString(err),
            );
            addToast(t('qrIngest.contactImportFailed'), 'error');
          }
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
      })();
    });

    return unsub;
  }, [addToast, t]);
}
