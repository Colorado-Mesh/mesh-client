import { Upload } from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RemotePathCapabilityChip } from '@/renderer/components/remote/RemotePathCapabilityChip';
import { useToast } from '@/renderer/components/Toast';
import { useRemotePathCapability } from '@/renderer/hooks/useRemotePathCapability';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { parseReticulumDestinationInput } from '@/renderer/lib/reticulum/reticulumDestinationInput';
import { sendRncpRequestEnable } from '@/renderer/lib/sendRncpRequestEnable';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

export interface ChatDmRncpControlProps {
  /** LXMF peer destination hash for the open DM (32 hex chars). */
  lxmfPeerHash: string;
  peerLabel: string;
  sidecarRunning: boolean;
}

/**
 * Chat DM header control for Reticulum: sends a file to the open peer via rncp, and
 * surfaces (accept/reject) any pending inbound offer from that same identity — a minimal
 * peer-scoped slice of `ReticulumRemotePanel`'s Transfer tab, not a full LXMF attachment UI.
 */
export function ChatDmRncpControl({
  lxmfPeerHash,
  peerLabel,
  sidecarRunning,
}: ChatDmRncpControlProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();

  const findByLxmfPeer = useReticulumRemoteAddressStore((s) => s.findByLxmfPeer);
  const upsertAddress = useReticulumRemoteAddressStore((s) => s.upsert);
  const startTransfer = useRncpTransferStore((s) => s.startTransfer);
  const pendingOffers = useRncpTransferStore((s) => s.pendingOffers);
  const removeOffer = useRncpTransferStore((s) => s.removeOffer);

  const savedAddress = findByLxmfPeer(lxmfPeerHash);

  const [open, setOpen] = useState(false);
  const [destinationInput, setDestinationInput] = useState(savedAddress?.destination_hash ?? '');
  const [rememberAddress, setRememberAddress] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync the destination field when the open DM peer changes or its saved address is resolved
    setDestinationInput(savedAddress?.destination_hash ?? '');
  }, [savedAddress?.destination_hash, lxmfPeerHash]);

  const parsedHash = parseReticulumDestinationInput(destinationInput);
  const { capability, loading: capabilityLoading } = useRemotePathCapability(
    open ? parsedHash : null,
  );

  const relevantOffers = useMemo(
    () =>
      [...pendingOffers.values()].filter(
        (o) => o.identity_hash?.toLowerCase() === lxmfPeerHash.toLowerCase(),
      ),
    [pendingOffers, lxmfPeerHash],
  );

  const notifiedOfferIdsRef = useRef(new Set<string>());
  useEffect(() => {
    for (const offer of relevantOffers) {
      if (notifiedOfferIdsRef.current.has(offer.transfer_id)) continue;
      notifiedOfferIdsRef.current.add(offer.transfer_id);
      addToast(
        t('chatPanel.rncp.newOfferToast', { peer: peerLabel, file: offer.file_name }),
        'info',
      );
    }
  }, [relevantOffers, addToast, peerLabel, t]);

  const handleSend = useCallback(async () => {
    if (!parsedHash) {
      addToast(t('reticulumRemote.errors.invalidAddress'), 'error');
      return;
    }
    const picked = await window.electronAPI.reticulum.rncp.showOpenFileDialog();
    if (picked.canceled || !picked.path) return;
    setSending(true);
    try {
      const res = await window.electronAPI.reticulum.rncp.send({
        destination_hash: parsedHash,
        path: picked.path,
      });
      if (!res.ok || !res.transfer_id) {
        addToast(
          t('chatPanel.rncp.sendFailed', { error: res.error ?? t('common.error') }),
          'error',
        );
        return;
      }
      const fileName = picked.path.split(/[/\\]/).pop() ?? picked.path;
      startTransfer({
        transfer_id: res.transfer_id,
        kind: 'send',
        destination_hash: parsedHash,
        file_name: fileName,
        retryArgs: { path: picked.path },
      });
      if (rememberAddress && !savedAddress) {
        await upsertAddress({
          label: peerLabel,
          service: 'rncp',
          destination_hash: parsedHash,
          lxmf_peer_hash: lxmfPeerHash,
        });
      }
      addToast(t('chatPanel.rncp.sendStarted', { file: fileName }), 'success');
      setOpen(false);
    } catch (e) {
      console.debug('[ChatDmRncpControl] send ' + errLikeToLogString(e));
      addToast(t('chatPanel.rncp.sendFailed', { error: errLikeToLogString(e) }), 'error');
    } finally {
      setSending(false);
    }
  }, [
    addToast,
    lxmfPeerHash,
    parsedHash,
    peerLabel,
    rememberAddress,
    savedAddress,
    startTransfer,
    t,
    upsertAddress,
  ]);

  const handleAcceptOffer = useCallback(
    async (transferId: string) => {
      try {
        await window.electronAPI.reticulum.rncp.accept({ transfer_id: transferId });
        removeOffer(transferId);
      } catch (e) {
        console.debug('[ChatDmRncpControl] accept ' + errLikeToLogString(e));
        addToast(
          t('reticulumRemote.transfer.acceptFailed', { error: errLikeToLogString(e) }),
          'error',
        );
      }
    },
    [addToast, removeOffer, t],
  );

  const handleRejectOffer = useCallback(
    async (transferId: string) => {
      try {
        await window.electronAPI.reticulum.rncp.reject({ transfer_id: transferId });
      } catch (e) {
        console.warn('[ChatDmRncpControl] reject ' + errLikeToLogString(e));
      } finally {
        removeOffer(transferId);
      }
    },
    [removeOffer],
  );

  const handleRequestEnable = useCallback(async () => {
    const res = await sendRncpRequestEnable(lxmfPeerHash);
    if (res.ok) {
      addToast(t('reticulumRemote.transfer.requestEnableSent'), 'success');
      return;
    }
    if (res.error === 'rate_limited') {
      addToast(t('reticulumRemote.transfer.requestEnableRateLimited'), 'info');
      return;
    }
    addToast(
      t('reticulumRemote.transfer.requestEnableFailed', {
        error: res.detail ?? t('common.error'),
      }),
      'error',
    );
  }, [addToast, lxmfPeerHash, t]);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('chatPanel.rncp.sendFileAria', { name: peerLabel })}
        aria-expanded={open}
        disabled={!sidecarRunning}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="relative inline-flex items-center gap-1 rounded-lg border border-gray-700/60 bg-gray-800/40 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700/60 disabled:opacity-50"
      >
        <Upload size={13} aria-hidden="true" />
        {t('chatPanel.rncp.sendFile')}
        {relevantOffers.length > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-semibold text-white"
            aria-label={t('chatPanel.rncp.pendingOffersBadgeAria', {
              count: relevantOffers.length,
            })}
          >
            {relevantOffers.length}
          </span>
        )}
      </button>

      {open && (
        <div className="bg-secondary-dark absolute top-full right-0 z-20 mt-1 w-72 space-y-2 rounded-lg border border-gray-600/50 p-3 shadow-xl">
          {relevantOffers.length > 0 && (
            <div className="space-y-1 border-b border-gray-700/60 pb-2">
              <p className="text-[11px] font-medium text-amber-300">
                {t('reticulumRemote.transfer.pendingOffersTitle')}
              </p>
              {relevantOffers.map((offer) => (
                <div
                  key={offer.transfer_id}
                  className="flex items-center gap-1 text-[11px] text-amber-100"
                >
                  <span className="min-w-0 flex-1 truncate">{offer.file_name}</span>
                  <button
                    type="button"
                    aria-label={t('reticulumRemote.transfer.acceptAria', {
                      file: offer.file_name,
                    })}
                    onClick={() => void handleAcceptOffer(offer.transfer_id)}
                    className="rounded bg-green-800/60 px-1.5 py-0.5 text-green-200 hover:bg-green-800"
                  >
                    {t('reticulumRemote.transfer.accept')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('reticulumRemote.transfer.rejectAria', {
                      file: offer.file_name,
                    })}
                    onClick={() => void handleRejectOffer(offer.transfer_id)}
                    className="rounded bg-red-900/60 px-1.5 py-0.5 text-red-200 hover:bg-red-900"
                  >
                    {t('reticulumRemote.transfer.reject')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <label className="block text-[11px] text-gray-400" htmlFor="chat-dm-rncp-dest">
            {t('chatPanel.rncp.destinationLabel')}
          </label>
          <div className="flex items-center gap-1">
            <input
              id="chat-dm-rncp-dest"
              type="text"
              value={destinationInput}
              onChange={(e) => {
                setDestinationInput(e.target.value);
              }}
              aria-label={t('reticulumRemote.transfer.destinationAria')}
              className="bg-secondary-dark/80 min-w-0 flex-1 rounded border border-gray-600/50 px-2 py-1 text-xs text-gray-200 focus:border-blue-500/50 focus:outline-none"
            />
            <RemotePathCapabilityChip capability={capability} loading={capabilityLoading} />
          </div>
          {!savedAddress && (
            <label className="flex items-center gap-2 text-[11px] text-gray-400">
              <input
                type="checkbox"
                checked={rememberAddress}
                onChange={(e) => {
                  setRememberAddress(e.target.checked);
                }}
                aria-label={t('chatPanel.rncp.rememberAddressAria')}
                className="accent-brand-green"
              />
              {t('chatPanel.rncp.rememberAddress')}
            </label>
          )}
          <button
            type="button"
            disabled={!parsedHash || sending}
            aria-label={t('reticulumRemote.transfer.sendAria')}
            onClick={() => void handleSend()}
            className="w-full rounded bg-blue-700/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {sending ? t('chatPanel.rncp.sending') : t('chatPanel.rncp.chooseAndSend')}
          </button>
          <button
            type="button"
            disabled={!sidecarRunning}
            aria-label={t('chatPanel.rncp.requestEnableAria')}
            onClick={() => void handleRequestEnable()}
            className="w-full rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            {t('chatPanel.rncp.requestEnable')}
          </button>
        </div>
      )}
    </div>
  );
}
