import { Upload } from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal } from '@/renderer/components/ConfirmModal';
import { RemotePathCapabilityChip } from '@/renderer/components/remote/RemotePathCapabilityChip';
import { useToast } from '@/renderer/components/Toast';
import { useRemotePathCapability } from '@/renderer/hooks/useRemotePathCapability';
import {
  findLatestRncpReceiveDestShareInDmCandidates,
  type RncpDmShareCandidate,
} from '@/renderer/lib/applyRncpReceiveDestShareFromChatHistory';
import { ensureRncpDestinationReachable } from '@/renderer/lib/ensureRncpDestinationReachable';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { parseReticulumDestinationInput } from '@/renderer/lib/reticulum/reticulumDestinationInput';
import { RETICULUM_DM_HEADER_ACTION_CLASS } from '@/renderer/lib/reticulumDmHeaderActions';
import { rncpOfferMatchesLxmfPeer } from '@/renderer/lib/rncpOfferPeerMatch';
import {
  acceptRncpOffer,
  rejectRncpOffer,
  toastRncpRequestEnableResult,
} from '@/renderer/lib/rncpTransferUiHelpers';
import { sendRncpRequestEnable } from '@/renderer/lib/sendRncpRequestEnable';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import {
  type RncpTransferUiStatus,
  useRncpTransferStore,
} from '@/renderer/stores/rncpTransferStore';
import { resolveRemoteReasonI18nKey } from '@/shared/remote-types';

export interface ChatDmRncpControlProps {
  /** LXMF peer destination hash for the open DM (32 hex chars). */
  lxmfPeerHash: string;
  peerLabel: string;
  sidecarRunning: boolean;
  /** Inbound messages already filtered to this DM (most reliable share source). */
  dmShareCandidates?: readonly RncpDmShareCandidate[];
}

const TRANSFER_STATUS_BADGE_CLASS: Record<RncpTransferUiStatus, string> = {
  active: 'bg-blue-800/60 text-blue-200',
  completed: 'bg-green-800/60 text-green-200',
  failed: 'bg-red-900/60 text-red-200',
  cancelled: 'bg-gray-700/60 text-gray-300',
};

/**
 * Chat DM header control for Reticulum: sends a file to the open peer via rncp, and
 * surfaces (accept/reject) any pending inbound offer from that same identity — a minimal
 * peer-scoped slice of `ReticulumRemotePanel`'s Transfer tab, not a full LXMF attachment UI.
 */
export function ChatDmRncpControl({
  lxmfPeerHash,
  peerLabel,
  sidecarRunning,
  dmShareCandidates = [],
}: Readonly<ChatDmRncpControlProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();

  const addresses = useReticulumRemoteAddressStore((s) => s.addresses);
  const hydrateAddresses = useReticulumRemoteAddressStore((s) => s.hydrate);
  const upsertAddress = useReticulumRemoteAddressStore((s) => s.upsert);
  const removeAddress = useReticulumRemoteAddressStore((s) => s.remove);
  const startTransfer = useRncpTransferStore((s) => s.startTransfer);
  const transfers = useRncpTransferStore((s) => s.transfers);
  const pendingOffers = useRncpTransferStore((s) => s.pendingOffers);
  const removeOffer = useRncpTransferStore((s) => s.removeOffer);

  const savedAddress = useMemo(() => {
    const key = lxmfPeerHash.trim().toLowerCase();
    for (const row of addresses.values()) {
      if (row.lxmf_peer_hash?.toLowerCase() === key) return row;
    }
    return undefined;
  }, [addresses, lxmfPeerHash]);

  const otherSavedLabels = useMemo(() => {
    if (savedAddress || addresses.size === 0) return [];
    return [...addresses.values()]
      .filter((a) => a.service === 'rncp' && a.lxmf_peer_hash)
      .map((a) => a.label || a.lxmf_peer_hash!.slice(0, 8))
      .slice(0, 3);
  }, [addresses, savedAddress]);

  const [open, setOpen] = useState(false);
  const [destinationInput, setDestinationInput] = useState(savedAddress?.destination_hash ?? '');
  const [rememberAddress, setRememberAddress] = useState(false);
  const [sending, setSending] = useState(false);
  const [enableRequestConfirmOpen, setEnableRequestConfirmOpen] = useState(false);
  const [localTransferIds, setLocalTransferIds] = useState<string[]>([]);
  const chatShareAppliedRef = useRef<string | null>(null);
  const notifiedTerminalRef = useRef(new Set<string>());

  useEffect(() => {
    void hydrateAddresses();
  }, [hydrateAddresses]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync the destination field when the open DM peer changes or its saved address is resolved
    setDestinationInput(savedAddress?.destination_hash ?? '');
  }, [savedAddress?.destination_hash, lxmfPeerHash]);

  // Older peers paste share sentinels into chat — prefill only (Remember checkbox persists).
  useEffect(() => {
    if (!open || savedAddress) return;
    if (dmShareCandidates.length === 0) return;
    const fromDm = findLatestRncpReceiveDestShareInDmCandidates(dmShareCandidates);
    if (!fromDm) return;
    if (chatShareAppliedRef.current === fromDm.receiveHash) return;
    chatShareAppliedRef.current = fromDm.receiveHash;
    setDestinationInput(fromDm.receiveHash);
    // dmShareCandidates identity changes every parent render — key off length + peer + open.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: scan when panel opens / peer changes
  }, [dmShareCandidates.length, lxmfPeerHash, open, savedAddress]);

  const parsedHash = parseReticulumDestinationInput(destinationInput);
  // Always probe the LXMF chat peer — rncp.receive destinations are usually absent from
  // the path table until a transfer link forms, which falsely flips the chip to Unknown.
  const { capability, loading: capabilityLoading } = useRemotePathCapability(
    open ? lxmfPeerHash : null,
  );
  const pathConstrained = capability?.speed === 'constrained';

  const relevantOffers = useMemo(
    () =>
      [...pendingOffers.values()].filter((o) =>
        rncpOfferMatchesLxmfPeer(o.identity_hash, lxmfPeerHash),
      ),
    [pendingOffers, lxmfPeerHash],
  );

  const allPeerTransfers = useMemo(() => {
    const dest = (savedAddress?.destination_hash ?? parsedHash ?? '').toLowerCase();
    const localIds = new Set(localTransferIds);
    return [...transfers.values()]
      .filter((tr) => {
        if (localIds.has(tr.transfer_id)) return true;
        if (dest && tr.destination_hash === dest) return true;
        return false;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [localTransferIds, parsedHash, savedAddress?.destination_hash, transfers]);

  const peerTransfers = useMemo(() => allPeerTransfers.slice(0, 5), [allPeerTransfers]);

  const activeTransferCount = useMemo(
    () => allPeerTransfers.filter((tr) => tr.status === 'active').length,
    [allPeerTransfers],
  );

  // Toast terminal outcomes for transfers started from this control.
  useEffect(() => {
    for (const tr of peerTransfers) {
      if (tr.status === 'active') continue;
      if (!localTransferIds.includes(tr.transfer_id)) continue;
      if (notifiedTerminalRef.current.has(tr.transfer_id)) continue;
      notifiedTerminalRef.current.add(tr.transfer_id);
      if (tr.status === 'completed') {
        addToast(
          t('chatPanel.rncp.transferCompletedToast', { file: tr.file_name ?? '' }),
          'success',
        );
      } else if (tr.status === 'failed') {
        addToast(
          t('chatPanel.rncp.transferFailedToast', {
            file: tr.file_name ?? '',
            error: tr.error ?? t('common.error'),
          }),
          'error',
        );
      }
    }
  }, [addToast, localTransferIds, peerTransfers, t]);

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

  const handleDestinationChange = useCallback((raw: string) => {
    const parsed = parseReticulumDestinationInput(raw);
    setDestinationInput(parsed && raw.trim() !== parsed ? parsed : raw);
  }, []);

  const handleSend = useCallback(async () => {
    if (!parsedHash) {
      addToast(t('reticulumRemote.errors.invalidAddress'), 'error');
      return;
    }
    setSending(true);
    try {
      const reach = await ensureRncpDestinationReachable({
        destinationHash: parsedHash,
        lxmfPeerHash,
      });
      if (reach.status === 'peerUnreachable') {
        addToast(t('reticulumRemote.transfer.peerUnreachable'), 'error');
        return;
      }
      if (reach.status === 'listenerLikelyOff') {
        setEnableRequestConfirmOpen(true);
        return;
      }
      const picked = await window.electronAPI.reticulum.rncp.showOpenFileDialog();
      if (picked.canceled || !picked.path) return;
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
      const transferId = res.transfer_id;
      setLocalTransferIds((ids) => (ids.includes(transferId) ? ids : [...ids, transferId]));
      startTransfer({
        transfer_id: transferId,
        kind: 'send',
        destination_hash: parsedHash,
        file_name: fileName,
        retryArgs: { path: picked.path },
      });
      if (rememberAddress) {
        await upsertAddress({
          label: peerLabel,
          service: 'rncp',
          destination_hash: parsedHash,
          lxmf_peer_hash: lxmfPeerHash,
        });
      }
      addToast(t('chatPanel.rncp.sendStarted', { file: fileName }), 'success');
      setOpen(true);
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
    startTransfer,
    t,
    upsertAddress,
  ]);

  const handleForgetSaved = useCallback(async () => {
    if (!savedAddress) return;
    await removeAddress(savedAddress.id);
    chatShareAppliedRef.current = null;
    setDestinationInput('');
    setRememberAddress(false);
    addToast(t('chatPanel.rncp.forgotAddressToast'), 'info');
  }, [addToast, removeAddress, savedAddress, t]);

  const handleAcceptOffer = useCallback(
    async (transferId: string) => {
      await acceptRncpOffer(transferId, {
        removeOffer,
        addToast,
        t,
        logTag: 'ChatDmRncpControl',
      });
    },
    [addToast, removeOffer, t],
  );

  const handleRejectOffer = useCallback(
    async (transferId: string) => {
      await rejectRncpOffer(transferId, {
        removeOffer,
        logTag: 'ChatDmRncpControl',
      });
    },
    [removeOffer],
  );

  const handleCancel = useCallback(async (transferId: string) => {
    try {
      await window.electronAPI.reticulum.rncp.cancel({ transfer_id: transferId });
    } catch (e) {
      console.debug('[ChatDmRncpControl] cancel ' + errLikeToLogString(e));
    }
  }, []);

  const handleRequestEnable = useCallback(async () => {
    const res = await sendRncpRequestEnable(lxmfPeerHash);
    toastRncpRequestEnableResult(res, addToast, t);
    if (res.ok) {
      const fromDm = findLatestRncpReceiveDestShareInDmCandidates(dmShareCandidates);
      if (fromDm) {
        setDestinationInput(fromDm.receiveHash);
        addToast(t('chatPanel.rncp.filledFromChatToast'), 'success');
      }
    }
  }, [addToast, dmShareCandidates, lxmfPeerHash, t]);

  const handleConfirmEnableRequest = useCallback(() => {
    setEnableRequestConfirmOpen(false);
    void handleRequestEnable();
  }, [handleRequestEnable]);

  const handleUseFromChat = useCallback(() => {
    const fromDm = findLatestRncpReceiveDestShareInDmCandidates(dmShareCandidates);
    if (fromDm) {
      setDestinationInput(fromDm.receiveHash);
      addToast(t('chatPanel.rncp.filledFromChatToast'), 'success');
      return;
    }
    addToast(t('chatPanel.rncp.noShareInChat'), 'info');
  }, [addToast, dmShareCandidates, t]);

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
        className={`relative ${RETICULUM_DM_HEADER_ACTION_CLASS}`}
      >
        <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t('chatPanel.rncp.sendFile')}</span>
        {(relevantOffers.length > 0 || activeTransferCount > 0) && (
          <span
            className={`ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${
              relevantOffers.length > 0 ? 'bg-amber-600' : 'bg-blue-600'
            }`}
            aria-label={
              relevantOffers.length > 0
                ? t('chatPanel.rncp.pendingOffersBadgeAria', {
                    count: relevantOffers.length,
                  })
                : t('chatPanel.rncp.activeTransfersBadgeAria', {
                    count: activeTransferCount,
                  })
            }
          >
            {relevantOffers.length > 0 ? relevantOffers.length : activeTransferCount}
          </span>
        )}
      </button>

      {open && (
        <div className="bg-secondary-dark absolute top-full right-0 z-20 mt-1 w-80 space-y-2 rounded-lg border border-gray-600/50 p-3 shadow-xl">
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

          {peerTransfers.length > 0 && (
            <div className="space-y-1 border-b border-gray-700/60 pb-2">
              <p className="text-[11px] font-medium text-gray-300">
                {t('chatPanel.rncp.transfersTitle')}
              </p>
              {peerTransfers.map((transfer) => (
                <div key={transfer.transfer_id} className="space-y-1 text-[11px] text-gray-200">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="min-w-0 flex-1 truncate">{transfer.file_name ?? '—'}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 ${TRANSFER_STATUS_BADGE_CLASS[transfer.status]}`}
                    >
                      {transfer.status === 'active'
                        ? `${transfer.progress}%`
                        : t(`reticulumRemote.transfer.status.${transfer.status}`)}
                    </span>
                    {transfer.status === 'active' && (
                      <button
                        type="button"
                        aria-label={t('reticulumRemote.transfer.cancelAria', {
                          file: transfer.file_name ?? '',
                        })}
                        onClick={() => void handleCancel(transfer.transfer_id)}
                        className="rounded bg-red-900/50 px-1.5 py-0.5 text-red-300 hover:bg-red-900/70"
                      >
                        {t('reticulumRemote.transfer.cancel')}
                      </button>
                    )}
                  </div>
                  {transfer.status === 'active' && (
                    <div
                      className="h-1.5 w-full overflow-hidden rounded bg-gray-700/80"
                      role="progressbar"
                      aria-valuenow={transfer.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={t('chatPanel.rncp.transferProgressAria', {
                        file: transfer.file_name ?? '',
                        progress: transfer.progress,
                      })}
                    >
                      <div
                        className="h-full bg-blue-500 transition-[width] duration-200"
                        style={{ width: `${Math.max(2, transfer.progress)}%` }}
                      />
                    </div>
                  )}
                  {transfer.status === 'failed' && transfer.error && (
                    <span className="block truncate text-[10px] text-red-300/90">
                      {transfer.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <label className="block text-[11px] text-gray-400" htmlFor="chat-dm-rncp-dest">
            {t('chatPanel.rncp.destinationLabel')}
          </label>
          <p className="text-[10px] leading-snug text-gray-500">
            {t('chatPanel.rncp.destinationHelp')}
          </p>
          {otherSavedLabels.length > 0 && (
            <p className="text-[10px] leading-snug text-amber-200/90">
              {t('chatPanel.rncp.savedForOtherPeers', { peers: otherSavedLabels.join(', ') })}
            </p>
          )}
          <div className="flex items-center gap-1">
            <input
              id="chat-dm-rncp-dest"
              type="text"
              value={destinationInput}
              onChange={(e) => {
                handleDestinationChange(e.target.value);
              }}
              onBlur={() => {
                const parsed = parseReticulumDestinationInput(destinationInput);
                if (parsed) setDestinationInput(parsed);
              }}
              aria-label={t('reticulumRemote.transfer.destinationAria')}
              className="bg-secondary-dark/80 min-w-0 flex-1 rounded border border-gray-600/50 px-2 py-1 text-xs text-gray-200 focus:border-blue-500/50 focus:outline-none"
            />
            <RemotePathCapabilityChip capability={capability} loading={capabilityLoading} />
          </div>
          {pathConstrained && capability && (
            <p className="text-[10px] leading-snug text-amber-200/90">
              {t('reticulumRemote.transfer.notAllowedHint', {
                reason: capability.reason_key
                  ? t(
                      resolveRemoteReasonI18nKey(capability.reason_key) ??
                        'reticulumRemote.reasons.pathConstrained',
                    )
                  : t('reticulumRemote.reasons.pathConstrained'),
              })}
            </p>
          )}
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
          {savedAddress && (
            <button
              type="button"
              aria-label={t('chatPanel.rncp.forgetAddressAria')}
              onClick={() => void handleForgetSaved()}
              className="w-full rounded border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40"
            >
              {t('chatPanel.rncp.forgetAddress')}
            </button>
          )}
          <button
            type="button"
            disabled={!parsedHash || sending}
            aria-label={t('reticulumRemote.transfer.sendAria')}
            aria-busy={sending}
            onClick={() => void handleSend()}
            className="w-full rounded bg-blue-700/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {sending
              ? t('reticulumRemote.transfer.checkingReachability')
              : t('chatPanel.rncp.chooseAndSend')}
          </button>
          {!savedAddress && (
            <button
              type="button"
              disabled={!sidecarRunning}
              aria-label={t('chatPanel.rncp.useFromChatAria')}
              onClick={() => {
                handleUseFromChat();
              }}
              className="w-full rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {t('chatPanel.rncp.useFromChat')}
            </button>
          )}
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
      {enableRequestConfirmOpen && (
        <ConfirmModal
          title={t('reticulumRemote.transfer.listenerLikelyOffTitle')}
          message={t('reticulumRemote.transfer.listenerLikelyOffBody')}
          confirmLabel={t('reticulumRemote.transfer.listenerLikelyOffConfirm')}
          onConfirm={handleConfirmEnableRequest}
          onCancel={() => {
            setEnableRequestConfirmOpen(false);
          }}
        />
      )}
    </div>
  );
}
