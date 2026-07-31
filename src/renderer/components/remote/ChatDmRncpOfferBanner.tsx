import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { rncpOfferMatchesLxmfPeer } from '@/renderer/lib/rncpOfferPeerMatch';
import { acceptRncpOffer, rejectRncpOffer } from '@/renderer/lib/rncpTransferUiHelpers';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

export interface ChatDmRncpOfferBannerProps {
  lxmfPeerHash: string;
}

/**
 * Sticky Chat DM banner for ASK-mode inbound rncp offers from the open peer.
 * Accept/Reject stay visible above the composer without opening Send file.
 */
export function ChatDmRncpOfferBanner({ lxmfPeerHash }: Readonly<ChatDmRncpOfferBannerProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const pendingOffers = useRncpTransferStore((s) => s.pendingOffers);
  const removeOffer = useRncpTransferStore((s) => s.removeOffer);

  const offers = useMemo(
    () =>
      [...pendingOffers.values()].filter((o) =>
        rncpOfferMatchesLxmfPeer(o.identity_hash, lxmfPeerHash),
      ),
    [pendingOffers, lxmfPeerHash],
  );

  const handleAccept = useCallback(
    async (transferId: string) => {
      await acceptRncpOffer(transferId, {
        removeOffer,
        addToast,
        t,
        logTag: 'ChatDmRncpOfferBanner',
      });
    },
    [addToast, removeOffer, t],
  );

  const handleReject = useCallback(
    async (transferId: string) => {
      await rejectRncpOffer(transferId, {
        removeOffer,
        logTag: 'ChatDmRncpOfferBanner',
      });
    },
    [removeOffer],
  );

  if (offers.length === 0) return null;

  return (
    <div
      className="mb-2 rounded-lg border border-amber-700/50 bg-amber-900/25 px-3 py-2"
      role="region"
      aria-label={t('chatPanel.rncp.offerBannerTitleAria')}
    >
      <p className="mb-1.5 text-xs font-medium text-amber-200">
        {t('chatPanel.rncp.offerBannerTitle')}
      </p>
      <ul className="space-y-1.5">
        {offers.map((offer) => (
          <li
            key={offer.transfer_id}
            className="flex flex-wrap items-center gap-2 text-xs text-amber-100"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{offer.file_name}</span>
            <button
              type="button"
              aria-label={t('reticulumRemote.transfer.acceptAria', { file: offer.file_name })}
              onClick={() => void handleAccept(offer.transfer_id)}
              className="rounded bg-green-800/70 px-2 py-0.5 text-green-100 hover:bg-green-800"
            >
              {t('reticulumRemote.transfer.accept')}
            </button>
            <button
              type="button"
              aria-label={t('reticulumRemote.transfer.rejectAria', { file: offer.file_name })}
              onClick={() => void handleReject(offer.transfer_id)}
              className="rounded bg-red-900/70 px-2 py-0.5 text-red-100 hover:bg-red-900"
            >
              {t('reticulumRemote.transfer.reject')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
