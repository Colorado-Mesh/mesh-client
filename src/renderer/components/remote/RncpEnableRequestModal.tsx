import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { rememberRncpListenerDirs } from '@/renderer/lib/pushRncpListenerPolicy';
import { policiesToRncpLists } from '@/renderer/lib/rncpInboundPolicyLists';
import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumInboundPolicyStore } from '@/renderer/stores/reticulumInboundPolicyStore';
import { useRncpEnableRequestStore } from '@/renderer/stores/rncpEnableRequestStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';
import { buildRncpReceiveDestShareBody } from '@/shared/rncpRequestEnable';

/**
 * Resolve a Reticulum **identity** hash for an LXMF delivery destination hash.
 * rncp LinkIdentify gates on identity_hash, which is not the LXMF sender dest.
 */
async function resolveIdentityHashForLxmfPeer(peerDestHash: string): Promise<string | null> {
  const dest = canonicalizeReticulumDestinationHash(peerDestHash);
  if (!dest) return null;
  const store = useReticulumIdentityActivityStore.getState();
  let rows = store.getActivity(dest);
  if (rows.length === 0) {
    rows = await store.loadForDestination(dest);
  }
  for (const row of rows) {
    const id = row.identity_hash ? canonicalizeReticulumDestinationHash(row.identity_hash) : null;
    if (id) return id;
  }
  return null;
}

/**
 * After enabling inbound rncp, share our rncp.receive hash with the requester
 * so their Chat DM / Transfer field can autofill (mesh-client peers only).
 */
async function shareRncpReceiveDestWithPeer(
  peerLxmfHash: string,
  instructions: string,
): Promise<'shared' | 'no_hash' | 'failed'> {
  const dest = canonicalizeReticulumDestinationHash(peerLxmfHash);
  if (!dest) return 'failed';
  try {
    const identity = await window.electronAPI.reticulum.remote.getIdentity();
    const receiveHash = identity?.rncp_receive_hash
      ? canonicalizeReticulumDestinationHash(identity.rncp_receive_hash)
      : null;
    if (!receiveHash) {
      console.debug('[RncpEnableRequestModal] no rncp_receive_hash to share');
      return 'no_hash';
    }
    const text = buildRncpReceiveDestShareBody(instructions, receiveHash);
    const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/send', {
      destination_hash: dest,
      text,
    })) as { ok?: boolean; error?: string };
    if (res?.ok === false) {
      console.debug('[RncpEnableRequestModal] share receive dest failed: ' + (res.error ?? ''));
      return 'failed';
    }
    // Best-effort: flood rncp.receive so the peer can resolve pubkey/path immediately.
    try {
      const ann = await window.electronAPI.reticulum.rncp.announce();
      if (!ann?.ok) {
        console.debug('[RncpEnableRequestModal] rncp announce after share: ' + (ann.error ?? ''));
      }
    } catch (annErr) {
      console.debug(
        '[RncpEnableRequestModal] rncp announce after share ' + errLikeToLogString(annErr),
      );
    }
    return 'shared';
  } catch (e) {
    // Non-fatal: listener is already enabled; peer can copy the hash manually.
    console.debug('[RncpEnableRequestModal] share receive dest ' + errLikeToLogString(e));
    return 'failed';
  }
}

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
  const setListener = useRncpTransferStore((s) => s.setListener);

  const current = prompts[0] ?? null;
  const autoSharedPeerRef = useRef<string | null>(null);

  // If inbound rncp is already enabled, re-share our receive dest immediately so the
  // requester does not stay empty when the peer thinks they are "already enabled".
  useEffect(() => {
    if (!current) return;
    const peerHash = current.peerHash;
    if (autoSharedPeerRef.current === peerHash) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await window.electronAPI.reticulum.rncp.getListener();
        if (cancelled) return;
        setListener(status);
        if (!status?.enabled) return;
        autoSharedPeerRef.current = peerHash;
        const shareResult = await shareRncpReceiveDestWithPeer(
          peerHash,
          t('reticulumRemote.enableRequest.lxmfShareBody'),
        );
        if (!cancelled && shareResult === 'shared') {
          dismiss(peerHash, false);
        }
      } catch (e) {
        console.debug(
          '[RncpEnableRequestModal] already-enabled auto-share ' + errLikeToLogString(e),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, dismiss, setListener, t]);

  const enableListener = useCallback(
    async (allowIdentity: boolean) => {
      if (!current) return;
      try {
        const dir = await window.electronAPI.reticulum.rncp.showSaveDirectoryDialog();
        if (dir.canceled || !dir.path) {
          addToast(t('reticulumRemote.enableRequest.saveDirRequired'), 'info');
          return;
        }

        let identityHash: string | null = null;
        if (allowIdentity) {
          identityHash = await resolveIdentityHashForLxmfPeer(current.peerHash);
          if (!identityHash) {
            addToast(t('reticulumRemote.enableRequest.identityUnknown'), 'info');
          } else {
            await upsertPolicy({
              identity_hash: identityHash,
              decision: 'allow',
              label: current.peerLabel,
            });
          }
        }

        const { allowed, blocked } = policiesToRncpLists(
          useReticulumInboundPolicyStore.getState().policies,
        );
        const res = await window.electronAPI.reticulum.rncp.setListener({
          enabled: true,
          save_dir: dir.path,
          allowed,
          blocked,
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
        rememberRncpListenerDirs({
          inboundMode: 'ask',
          lastSaveDir: dir.path,
          allowFetch: false,
        });
        const listener = await window.electronAPI.reticulum.rncp.getListener();
        useRncpTransferStore.getState().setListener(listener);
        setInboundModeOptimistic('ask');
        addToast(t('reticulumRemote.enableRequest.enabled'), 'success');
        const peerHash = current.peerHash;
        dismiss(peerHash, false);
        // Best-effort: tell the requester our rncp.receive dest so they can autofill.
        void shareRncpReceiveDestWithPeer(
          peerHash,
          t('reticulumRemote.enableRequest.lxmfShareBody'),
        );
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
        <p className="mt-2 text-xs text-amber-200/90">
          {t('reticulumRemote.enableRequest.shareDestWarning')}
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
