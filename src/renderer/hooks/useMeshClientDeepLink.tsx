import { type ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal } from '@/renderer/components/ConfirmModal';
import { useToast } from '@/renderer/components/Toast';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  applyMeshcoreChannelAdd,
  applyMeshcoreContactAdd,
} from '@/renderer/lib/meshClientDeepLinkApply';
import { classifyMeshClientDeepLink } from '@/shared/meshClientDeepLink';

type PendingImport =
  | {
      kind: 'meshcoreContactAdd';
      name: string;
      publicKeyHex: string;
      type: number;
    }
  | {
      kind: 'meshcoreChannelAdd';
      name: string;
      secretHex: string;
      regionScope?: string;
    };

/**
 * Mount once from App: listen for meshcore:// / Meshtastic / OS deep links and route actions.
 * External imports require explicit confirmation.
 */
export function MeshClientDeepLinkHost(): ReactElement | null {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    const api = window.electronAPI?.deepLink;
    if (!api?.onOpenUrl) return undefined;

    const unsub = api.onOpenUrl((url) => {
      const parsed = classifyMeshClientDeepLink(url);
      if (parsed.kind === 'meshcoreContactAdd') {
        setPending({
          kind: 'meshcoreContactAdd',
          name: parsed.name,
          publicKeyHex: parsed.publicKeyHex,
          type: parsed.type,
        });
        return;
      }
      if (parsed.kind === 'meshcoreChannelAdd') {
        setPending({
          kind: 'meshcoreChannelAdd',
          name: parsed.name,
          secretHex: parsed.secretHex,
          ...(parsed.regionScope !== undefined ? { regionScope: parsed.regionScope } : {}),
        });
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
    if (!pending || importBusy) return;
    setImportBusy(true);
    try {
      if (pending.kind === 'meshcoreContactAdd') {
        const result = await applyMeshcoreContactAdd(pending, {
          saveContact: async ({ nodeId, publicKeyHex, name, contactType }) => {
            try {
              await window.electronAPI.db.saveMeshcoreContact({
                node_id: nodeId,
                public_key: publicKeyHex,
                adv_name: name,
                contact_type: contactType,
                on_radio: 0,
              });
              window.dispatchEvent(
                new CustomEvent('mesh-client:meshcoreContactFromQr', {
                  detail: { nodeId, publicKeyHex, name, contactType },
                }),
              );
              return true;
            } catch (err) {
              console.error(
                '[MeshClientDeepLinkHost] meshcore contact save failed: ' + errLikeToLogString(err),
              );
              return false;
            }
          },
        });
        if (result.ok) {
          addToast(t('qrIngest.meshcoreContactImported'), 'success');
          setPending(null);
        } else {
          addToast(t(result.errorKey), 'error');
        }
        return;
      }
      if (pending.kind === 'meshcoreChannelAdd') {
        const result = await applyMeshcoreChannelAdd(pending, {
          applyChannel: (opts) =>
            new Promise((resolve) => {
              let settled = false;
              const settle = (outcome: 'accepted' | 'rejected' | 'deferred') => {
                if (settled) return;
                settled = true;
                resolve(outcome);
              };
              window.dispatchEvent(
                new CustomEvent('mesh-client:meshcoreChannelFromQr', {
                  detail: {
                    ...opts,
                    settle: (outcome: 'accepted' | 'rejected') => {
                      settle(outcome);
                    },
                  },
                }),
              );
              // No MeshcoreChannelSection listener → keep pending for Radio review.
              queueMicrotask(() => {
                settle('deferred');
              });
            }),
        });
        if (result.ok && result.deferred) {
          addToast(t('qrIngest.meshcoreChannelImported'), 'success');
          return;
        }
        if (result.ok) {
          // MeshcoreChannelSection owns the prefill success toast.
          setPending(null);
        } else {
          addToast(t(result.errorKey), 'error');
        }
      }
    } finally {
      setImportBusy(false);
    }
  };

  if (!pending) return null;

  const label = pending.name;

  const titleKey =
    pending.kind === 'meshcoreChannelAdd'
      ? 'qrIngest.confirmMeshcoreChannelImportTitle'
      : 'qrIngest.confirmMeshcoreContactImportTitle';
  const bodyKey =
    pending.kind === 'meshcoreChannelAdd'
      ? 'qrIngest.confirmMeshcoreChannelImportBody'
      : 'qrIngest.confirmMeshcoreContactImportBody';
  const actionKey =
    pending.kind === 'meshcoreChannelAdd'
      ? 'qrIngest.confirmMeshcoreChannelImportAction'
      : 'qrIngest.confirmMeshcoreContactImportAction';

  return (
    <ConfirmModal
      title={t(titleKey)}
      message={t(bodyKey, { name: label })}
      confirmLabel={t(actionKey)}
      confirmDisabled={importBusy}
      onCancel={() => {
        if (!importBusy) setPending(null);
      }}
      onConfirm={() => {
        void confirmImport();
      }}
    />
  );
}
