import { Copy, MessageCircle, Star, X } from 'lucide-react-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatRelativeOrIsoDate } from '@/renderer/lib/formatRelativeOrIsoDate';
import { Z_NODE_DETAIL_MODAL } from '@/renderer/lib/modalZIndex';
import { normalizeLastHeardMs } from '@/renderer/lib/nodeStatus';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';

import { useReticulumPeerStore } from '../stores/reticulumPeerStore';

export interface ReticulumPeerDetailModalProps {
  peerHash: string;
  onClose: () => void;
  onSendMessage: (nodeNum: number) => void;
}

export default function ReticulumPeerDetailModal({
  peerHash,
  onClose,
  onSendMessage,
}: ReticulumPeerDetailModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const peer = useReticulumPeerStore((s) => s.getPeer(peerHash));
  const getDisplayName = useReticulumPeerStore((s) => s.getDisplayName);
  const toggleFavorite = useReticulumPeerStore((s) => s.toggleFavorite);
  const setCustomDisplayName = useReticulumPeerStore((s) => s.setCustomDisplayName);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [pathStatus, setPathStatus] = useState<string | null>(null);
  const [probeStatus, setProbeStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const displayLabel = peer ? getDisplayName(peer) : peerHash.slice(0, 16);

  const copyHash = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(peerHash);
    } catch (e) {
      console.warn('[ReticulumPeerDetailModal] copy ' + errLikeToLogString(e));
    }
  }, [peerHash]);

  const requestPath = async () => {
    setBusy(true);
    setPathStatus(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost(
        `/api/v1/peers/${peerHash}/path`,
        {},
      )) as { ok?: boolean; error?: string };
      setPathStatus(
        res.ok
          ? t('peerDetailModal.pathOk')
          : t('peerDetailModal.pathFailed', { error: res.error ?? '' }),
      );
    } catch (e) {
      console.warn('[ReticulumPeerDetailModal] path ' + errLikeToLogString(e));
      setPathStatus(t('peerDetailModal.pathFailed', { error: errLikeToLogString(e) }));
    } finally {
      setBusy(false);
    }
  };

  const probePeer = async () => {
    setBusy(true);
    setProbeStatus(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost(
        `/api/v1/peers/${peerHash}/probe`,
        {},
      )) as { ok?: boolean; hops?: number; error?: string; mode?: string };
      if (res.ok && res.hops != null) {
        setProbeStatus(t('peerDetailModal.probeHops', { hops: res.hops }));
      } else if (res.ok && res.mode) {
        setProbeStatus(t('peerDetailModal.probeLocal', { mode: res.mode }));
      } else {
        setProbeStatus(t('peerDetailModal.probeFailed', { error: res.error ?? t('common.error') }));
      }
    } catch (e) {
      console.warn('[ReticulumPeerDetailModal] probe ' + errLikeToLogString(e));
      setProbeStatus(t('peerDetailModal.probeFailed', { error: errLikeToLogString(e) }));
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    await setCustomDisplayName(peerHash, nameDraft);
    setEditingName(false);
  };

  const lastSeenMs = peer
    ? normalizeLastHeardMs(
        'last_heard' in peer ? (peer.last_heard ?? peer.last_seen ?? 0) : (peer.last_seen ?? 0),
      )
    : 0;

  const openChat = () => {
    const nodeId = reticulumHashToNodeId(peerHash);
    registerReticulumDestinationHash(nodeId, peerHash);
    onSendMessage(nodeId);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: Z_NODE_DETAIL_MODAL }}
    >
      <button
        type="button"
        aria-label={t('aria.closeDialog')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/70 p-0"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reticulum-peer-detail-title"
        className="bg-deep-black relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-gray-600 p-4 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => {
                    setNameDraft(e.target.value);
                  }}
                  className="flex-1 rounded border border-gray-600 bg-black px-2 py-1 text-sm text-gray-100"
                  aria-label={t('peerDetailModal.editNameAria')}
                />
                <button
                  type="button"
                  className="bg-readable-green rounded px-2 py-1 text-xs text-white"
                  onClick={() => {
                    void saveName();
                  }}
                >
                  {t('common.save')}
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300"
                  onClick={() => {
                    setEditingName(false);
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2
                  id="reticulum-peer-detail-title"
                  className="text-bright-green truncate text-lg font-semibold"
                >
                  {displayLabel}
                </h2>
                <button
                  type="button"
                  className="text-xs text-amber-400 hover:underline"
                  onClick={() => {
                    setNameDraft(peer?.custom_display_name ?? peer?.display_name ?? '');
                    setEditingName(true);
                  }}
                >
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  className={peer?.favorited ? 'text-yellow-400' : 'text-gray-500'}
                  aria-label={t('peerListPanel.toggleFavorite')}
                  onClick={() => {
                    void toggleFavorite(peerHash, !peer?.favorited);
                  }}
                >
                  <Star className="h-5 w-5" fill={peer?.favorited ? 'currentColor' : 'none'} />
                </button>
              </div>
            )}
            <div className="mt-1 flex items-center gap-2 font-mono text-xs text-gray-400">
              <span className="truncate" title={peerHash}>
                {peerHash}
              </span>
              <button
                type="button"
                className="shrink-0 text-amber-400 hover:text-amber-300"
                aria-label={t('peerDetailModal.copyHash')}
                onClick={() => {
                  void copyHash();
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-200"
            aria-label={t('aria.closeDialog')}
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <section className="mb-4 rounded border border-gray-700 p-3">
          <h3 className="text-sm font-medium text-gray-200">
            {t('peerDetailModal.networkSection')}
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">{t('peerListPanel.colInterface')}</dt>
            <dd>{peer?.interface ?? '—'}</dd>
            <dt className="text-muted">{t('connectionPanel.reticulumPeers.hops')}</dt>
            <dd>{peer?.hops ?? '—'}</dd>
            <dt className="text-muted">{t('peerDetailModal.pathHash')}</dt>
            <dd className="truncate font-mono">{peer?.path_hash ?? '—'}</dd>
            <dt className="text-muted">{t('peerListPanel.colLastSeen')}</dt>
            <dd>
              {lastSeenMs ? formatRelativeOrIsoDate(lastSeenMs, t, normalizeLastHeardMs) : '—'}
            </dd>
          </dl>
        </section>

        <section className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded border border-amber-600 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-950/40 disabled:opacity-40"
            onClick={() => {
              void requestPath();
            }}
          >
            {t('connectionPanel.reticulumPeers.path')}
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded border border-amber-600 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-950/40 disabled:opacity-40"
            onClick={() => {
              void probePeer();
            }}
          >
            {t('connectionPanel.reticulumPeers.probe')}
          </button>
          <button
            type="button"
            className="border-readable-green text-readable-green flex items-center gap-1 rounded border px-3 py-1.5 text-sm hover:bg-green-950/30"
            onClick={openChat}
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            {t('peerDetailModal.sendMessage')}
          </button>
        </section>

        {pathStatus ? <p className="mb-2 text-xs text-gray-300">{pathStatus}</p> : null}
        {probeStatus ? <p className="mb-2 text-xs text-gray-300">{probeStatus}</p> : null}
      </div>
    </div>
  );
}
