import { useTranslation } from 'react-i18next';

import ScanQrDisclosure from '@/renderer/components/ScanQrDisclosure';
import { useToast } from '@/renderer/components/Toast';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { MeshcoreQrImportResult } from '@/renderer/lib/meshcore/meshcoreQrIngest';
import { requestOpenSetting } from '@/renderer/lib/openSettingRequest';
import { handleReticulumQrIngest } from '@/renderer/lib/reticulum/handleReticulumQrIngest';
import { showReticulumQrIngestToast } from '@/renderer/lib/reticulum/showReticulumQrIngestToast';
import { routeScannedQr } from '@/renderer/lib/scanQrRoute';

export interface GlobalScanQrControlProps {
  /** MeshCore contact import (DB + store). Omit when protocol lacks contact QR. */
  importMeshcoreContactFromQr?: (text: string) => Promise<MeshcoreQrImportResult>;
  /** Called after a successful route so the parent can close the launcher. */
  onHandled?: () => void;
}

/**
 * Always-available Scan QR entry (launcher). Routes MeshCore contact/channel,
 * Meshtastic channel, and Reticulum QR kinds.
 */
export default function GlobalScanQrControl({
  importMeshcoreContactFromQr,
  onHandled,
}: GlobalScanQrControlProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();

  return (
    <ScanQrDisclosure
      label={t('qrIngest.globalScanHeading')}
      triggerAriaLabel={t('qrIngest.scanQrAria')}
      hint={t('qrIngest.globalScanHint')}
      onDecoded={async (text) => {
        try {
          const action = routeScannedQr(text);
          if (action.kind === 'meshcoreContact') {
            if (!importMeshcoreContactFromQr) {
              addToast(t('qrIngest.unknownLink'), 'error');
              return;
            }
            const result = await importMeshcoreContactFromQr(action.text);
            addToast(t(result.toastKey), result.ok ? 'success' : 'error');
            if (result.ok) onHandled?.();
            return;
          }
          if (action.kind === 'meshcoreChannel') {
            window.dispatchEvent(
              new CustomEvent('mesh-client:meshcoreChannelFromQr', { detail: action.channel }),
            );
            requestOpenSetting({ slot: 'Radio', id: 'radio.channels.meshcoreScan' });
            addToast(t('qrIngest.meshcoreChannelImported'), 'success');
            onHandled?.();
            return;
          }
          if (action.kind === 'meshtasticChannel') {
            window.dispatchEvent(
              new CustomEvent('mesh-client:meshtasticChannelUrl', { detail: action.url }),
            );
            requestOpenSetting({ slot: 'Radio', id: 'radio.channels.scanQr' });
            addToast(t('qrIngest.channelLinkReceived'), 'success');
            onHandled?.();
            return;
          }
          if (action.kind === 'reticulum') {
            const outcome = await handleReticulumQrIngest(action.text);
            if (showReticulumQrIngestToast(outcome, { t, addToast })) {
              if (outcome.handled && outcome.toast.variant === 'success') onHandled?.();
            }
            return;
          }
          addToast(t('qrIngest.unknownLink'), 'error');
        } catch (err: unknown) {
          console.error('[GlobalScanQrControl] failed: ' + errLikeToLogString(err));
          addToast(t('qrIngest.unknownLink'), 'error');
        }
      }}
    />
  );
}
