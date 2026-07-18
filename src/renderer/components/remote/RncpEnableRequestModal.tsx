import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useReticulumInboundPolicyStore } from '@/renderer/stores/reticulumInboundPolicyStore';
import { useRncpEnableRequestStore } from '@/renderer/stores/rncpEnableRequestStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

/**
 * Modal shown when a peer sends an LXMF DM containing
 * `mesh-client:request-rncp-receive:v1`. Does not auto-accept files.
 */
export function RncpEnableRequestModal() {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const prompts = useRncpEnableRequestStore((s) => s.prompts);
  const dismiss = useRncpEnableRequestStore((s) => s.dismiss);
  const upsertPolicy = useReticulumInboundPolicyStore((s) => s.upsert);
  const setInboundModeOptimistic = useRncpTransferStore((s) => s.setInboundModeOptimistic);

  const current = prompts[0] ?? null;

  const enableListener = useCallback(
    async (allowIdentity: boolean) => {
      if (!current) return;
      try {
        const dir = await window.electronAPI.reticulum.rncp.showSaveDirectoryDialog();
        if (dir.canceled || !dir.path) {
          addToast(t('reticulumRemote.enableRequest.saveDirRequired'), 'info');
          return;
        }
        setInboundModeOptimistic('ask');
        const res = await window.electronAPI.reticulum.rncp.setListener({
          enabled: true,
          save_dir: dir.path,
        });
        if (!res.ok) {
          addToast(
            t('reticulumRemote.enableRequest.enableFailed', {
              error: res.error ?? t('common.error'),
            }),
            'error',
          );
          return;
        }
        if (allowIdentity) {
          await upsertPolicy({
            identity_hash: current.peerHash,
            decision: 'allow',
            label: current.peerLabel,
          });
        }
        const listener = await window.electronAPI.reticulum.rncp.getListener();
        useRncpTransferStore.getState().setListener(listener);
        addToast(t('reticulumRemote.enableRequest.enabled'), 'success');
        dismiss(current.peerHash, false);
      } catch (e) {
        console.debug('[RncpEnableRequestModal] enable ' + errLikeToLogString(e));
        addToast(
          t('reticulumRemote.enableRequest.enableFailed', { error: errLikeToLogString(e) }),
          'error',
        );
      }
    },
    [addToast, current, dismiss, setInboundModeOptimistic, t, upsertPolicy],
  );

  if (!current) return null;

  const peer = current.peerLabel?.trim() || current.peerHash.slice(0, 12);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('reticulumRemote.enableRequest.title')}
    >
      <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-4 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-100">
          {t('reticulumRemote.enableRequest.title')}
        </h2>
        <p className="mt-2 text-sm text-gray-300">
          {t('reticulumRemote.enableRequest.body', { peer })}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            className="bg-readable-green rounded px-3 py-2 text-sm font-medium text-white"
            aria-label={t('reticulumRemote.enableRequest.enableAskAria')}
            onClick={() => void enableListener(false)}
          >
            {t('reticulumRemote.enableRequest.enableAsk')}
          </button>
          <button
            type="button"
            className="rounded bg-cyan-700 px-3 py-2 text-sm font-medium text-white"
            aria-label={t('reticulumRemote.enableRequest.enableAllowAria')}
            onClick={() => void enableListener(true)}
          >
            {t('reticulumRemote.enableRequest.enableAllow')}
          </button>
          <button
            type="button"
            className="rounded border border-gray-600 px-3 py-2 text-sm text-gray-200"
            aria-label={t('reticulumRemote.enableRequest.notNowAria')}
            onClick={() => {
              dismiss(current.peerHash, false);
            }}
          >
            {t('reticulumRemote.enableRequest.notNow')}
          </button>
          <button
            type="button"
            className="rounded px-3 py-2 text-sm text-gray-400 hover:text-gray-200"
            aria-label={t('reticulumRemote.enableRequest.dontAskAria')}
            onClick={() => {
              dismiss(current.peerHash, true);
            }}
          >
            {t('reticulumRemote.enableRequest.dontAsk')}
          </button>
        </div>
      </div>
    </div>
  );
}
