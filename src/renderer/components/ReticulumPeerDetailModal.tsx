import { Copy, MessageCircle, Star, X } from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatRelativeOrIsoDate } from '@/renderer/lib/formatRelativeOrIsoDate';
import { getIdentityIdForProtocol } from '@/renderer/lib/identityByProtocol';
import { Z_NODE_DETAIL_MODAL } from '@/renderer/lib/modalZIndex';
import { normalizeLastHeardMs } from '@/renderer/lib/nodeStatus';
import { getOfflineIdentityIdForProtocol } from '@/renderer/lib/offlineProtocolIdentities';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import {
  isDefaultReticulumProfileIcon,
  resolveReticulumProfileIconName,
} from '@/renderer/lib/reticulum/reticulumIconAppearance';
import {
  activeReticulumPathSlot,
  backupReticulumPathSlots,
  refreshReticulumPeerRouteFromPaths,
  RETICULUM_PATH_RETRY_MS,
  RETICULUM_PATH_SETTLE_MS,
  type ReticulumPeerPathsResult,
} from '@/renderer/lib/reticulum/reticulumPathMedium';
import {
  formatReticulumPeerPathToast,
  formatReticulumPeerProbeToast,
  probeReticulumPeer,
  requestReticulumPeerPath,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';
import { useBlockStore } from '@/renderer/stores/blockStore';
import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import {
  refreshReticulumPeersFromSidecar,
  resolveReticulumPeerLabel,
  useReticulumPeerStore,
} from '@/renderer/stores/reticulumPeerStore';
import { buildLxmaContactUri, buildLxmContactUri } from '@/shared/meshClientDeepLink';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';
import { formatReticulumIdentityFingerprint } from '@/shared/reticulumIdentityFingerprint';

import { ConfirmModal } from './ConfirmModal';
import QrCodeImage from './QrCodeImage';
import { type ReticulumProfileIconName, ReticulumProfileIconSlot } from './ReticulumProfileIcon';
import { useToast } from './Toast';

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
  const { addToast } = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);
  const peer = useReticulumPeerStore((s) => s.getPeer(peerHash));
  const isContact = useReticulumPeerStore((s) => s.isContact(peerHash));
  const toggleFavorite = useReticulumPeerStore((s) => s.toggleFavorite);
  const setCustomDisplayName = useReticulumPeerStore((s) => s.setCustomDisplayName);
  const removeContact = useReticulumPeerStore((s) => s.removeContact);
  const updatePeer = useReticulumPeerStore((s) => s.updatePeer);

  const identityId =
    getIdentityIdForProtocol('reticulum') ?? getOfflineIdentityIdForProtocol('reticulum');
  const isBlocked = useBlockStore((s) => s.isBlocked(peerHash));
  const blockContact = useBlockStore((s) => s.block);
  const unblockContact = useBlockStore((s) => s.unblock);
  const activityKey = peerHash.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const activityRows = useReticulumIdentityActivityStore((s) => s.byDestination.get(activityKey));
  const loadActivity = useReticulumIdentityActivityStore((s) => s.loadForDestination);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showContactQr, setShowContactQr] = useState(false);
  const [pathStatus, setPathStatus] = useState<string | null>(null);
  const [probeStatus, setProbeStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pathsResult, setPathsResult] = useState<ReticulumPeerPathsResult | null>(null);
  const [iconColor, setIconColor] = useState('green');
  const [iconName, setIconName] = useState<ReticulumProfileIconName>('circle');
  const [verified, setVerified] = useState(false);
  const [verifiedIdentityHash, setVerifiedIdentityHash] = useState<string | null>(null);

  const hydratePaths = useCallback(
    async (opts?: { settleMs?: number; retryMs?: number }) => {
      const result = await refreshReticulumPeerRouteFromPaths(peerHash, opts);
      setPathsResult(result);
      return result;
    },
    [peerHash],
  );

  useEffect(() => {
    void loadActivity(peerHash);
  }, [loadActivity, peerHash]);

  // Hydrate Network fields from sidecar path slots (path may already exist for Chat).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await refreshReticulumPeerRouteFromPaths(peerHash);
        if (!cancelled) setPathsResult(result);
      } catch (e) {
        if (!cancelled) {
          console.debug('[ReticulumPeerDetailModal] path hydrate ' + errLikeToLogString(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [peerHash]);

  const liveIdentityHash = useMemo(() => {
    const rows = activityRows ?? [];
    for (const row of rows) {
      const h = typeof row.identity_hash === 'string' ? row.identity_hash.trim().toLowerCase() : '';
      if (h) return h;
    }
    return '';
  }, [activityRows]);

  const verificationMismatch =
    verified &&
    Boolean(verifiedIdentityHash) &&
    Boolean(liveIdentityHash) &&
    verifiedIdentityHash !== liveIdentityHash;

  const fingerprint = formatReticulumIdentityFingerprint(liveIdentityHash || peerHash);

  const contactQrUri = useMemo(() => {
    try {
      const label = peer ? resolveReticulumPeerLabel(peer) : peerHash.slice(0, 12);
      const pub = peer?.public_key?.trim();
      if (pub && /^[0-9a-f]{128}$/i.test(pub)) {
        return buildLxmaContactUri(peerHash, pub);
      }
      return buildLxmContactUri(peerHash, label);
    } catch {
      // catch-no-log-ok Invalid destination hashes simply hide the optional contact QR.
      return null;
    }
  }, [peer, peerHash]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = (await window.electronAPI.db.getReticulumDestinations()) as Record<
          string,
          unknown
        >[];
        const key = canonicalizeReticulumDestinationHash(peerHash);
        const row = rows.find(
          (r) =>
            typeof r.destination_hash === 'string' &&
            canonicalizeReticulumDestinationHash(r.destination_hash) === key,
        );
        if (cancelled || !row) return;
        setVerified(row.verified === 1 || row.verified === true);
        setVerifiedIdentityHash(
          typeof row.verified_identity_hash === 'string' ? row.verified_identity_hash : null,
        );
      } catch (err) {
        console.warn(
          '[ReticulumPeerDetailModal] load verified state failed: ' + errLikeToLogString(err),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [peerHash]);

  useEffect(() => {
    const key = canonicalizeReticulumDestinationHash(peerHash);
    if (!key) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = (await window.electronAPI.db.getReticulumDestinations()) as {
          destination_hash?: string;
          icon_name?: string | null;
          icon_color?: string | null;
        }[];
        if (cancelled) return;
        const row = rows.find(
          (r) =>
            typeof r.destination_hash === 'string' &&
            canonicalizeReticulumDestinationHash(r.destination_hash) === key,
        );
        if (!row) return;
        const resolvedName = resolveReticulumProfileIconName(row.icon_name);
        const color = row.icon_color?.trim() || 'green';
        if (isDefaultReticulumProfileIcon(resolvedName, color)) {
          setIconName('circle');
          setIconColor('green');
        } else {
          setIconName(resolvedName);
          setIconColor(color);
        }
      } catch (err) {
        console.warn(
          '[ReticulumPeerDetailModal] load icon appearance failed: ' + errLikeToLogString(err),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [peerHash]);

  const saveIconAppearance = async (patch: { icon_color?: string; icon_name?: string }) => {
    const nextName = (patch.icon_name as ReticulumProfileIconName | undefined) ?? iconName;
    const nextColor = patch.icon_color ?? iconColor;
    const cleared = isDefaultReticulumProfileIcon(nextName, nextColor);
    const persistPatch = cleared
      ? { icon_name: 'circle', icon_color: 'green' }
      : {
          icon_name: nextName,
          icon_color: nextColor,
        };

    const previousName = iconName;
    const previousColor = iconColor;
    const previousAppearance = useReticulumPeerStore
      .getState()
      .peerAppearanceByHash.get(
        canonicalizeReticulumDestinationHash(peerHash) ??
          peerHash.replace(/[^0-9a-f]/gi, '').toLowerCase(),
      );

    setIconName(persistPatch.icon_name as ReticulumProfileIconName);
    setIconColor(persistPatch.icon_color);

    const key = canonicalizeReticulumDestinationHash(peerHash);
    if (!key) {
      setIconName(previousName);
      setIconColor(previousColor);
      console.warn('[ReticulumPeerDetailModal] icon appearance: invalid destination hash');
      addToast(t('reticulumProfileIcon.iconSaveFailed'), 'error');
      return;
    }

    useReticulumPeerStore.getState().patchPeerAppearance(key, persistPatch);

    try {
      await window.electronAPI.db.upsertReticulumDestination({
        destination_hash: key,
        ...persistPatch,
      });
    } catch (e) {
      setIconName(previousName);
      setIconColor(previousColor);
      if (previousAppearance) {
        useReticulumPeerStore.getState().patchPeerAppearance(key, previousAppearance);
      } else {
        useReticulumPeerStore.getState().patchPeerAppearance(key, {
          icon_name: 'circle',
          icon_color: 'green',
        });
      }
      console.warn('[ReticulumPeerDetailModal] icon appearance ' + errLikeToLogString(e));
      addToast(t('reticulumProfileIcon.iconSaveFailed'), 'error');
    }
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const displayLabel = peer
    ? resolveReticulumPeerLabel(peer, peer.display_name ?? peer.custom_display_name)
    : peerHash.slice(0, 12);

  const copyHash = useCallback(async () => {
    try {
      await writeClipboardText(peerHash);
    } catch (e) {
      console.warn('[ReticulumPeerDetailModal] copy ' + errLikeToLogString(e));
    }
  }, [peerHash]);

  const requestPath = async () => {
    setBusy(true);
    setPathStatus(null);
    try {
      const result = await requestReticulumPeerPath(peerHash);
      const toast = formatReticulumPeerPathToast(t, result);
      setPathStatus(toast.message);
      if (result.ok) {
        await hydratePaths({
          settleMs: RETICULUM_PATH_SETTLE_MS,
          retryMs: RETICULUM_PATH_RETRY_MS,
        });
      }
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
      const result = await probeReticulumPeer(peerHash);
      const toast = formatReticulumPeerProbeToast(t, result);
      setProbeStatus(toast.message);
      if (result.ok && result.hops != null) {
        updatePeer(peerHash, { hops: result.hops });
      }
      if (result.ok) {
        await hydratePaths();
      }
    } catch (e) {
      console.warn('[ReticulumPeerDetailModal] probe ' + errLikeToLogString(e));
      setProbeStatus(t('peerDetailModal.probeFailed', { error: errLikeToLogString(e) }));
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    try {
      await setCustomDisplayName(peerHash, nameDraft);
    } catch (err) {
      console.warn('[ReticulumPeerDetailModal] save name failed: ' + errLikeToLogString(err));
      addToast(t('peerDetailModal.renameFailed'), 'error');
    } finally {
      setEditingName(false);
    }
  };

  const lastSeenMs = peer
    ? normalizeLastHeardMs(
        'last_heard' in peer ? (peer.last_heard ?? peer.last_seen ?? 0) : (peer.last_seen ?? 0),
      )
    : 0;

  const activePathSlot = useMemo(
    () => (pathsResult?.ok ? activeReticulumPathSlot(pathsResult.paths) : null),
    [pathsResult],
  );
  const backupPathSlots = useMemo(
    () => (pathsResult?.ok ? backupReticulumPathSlots(pathsResult.paths) : []),
    [pathsResult],
  );
  const mediumLabel =
    activePathSlot?.medium === 'rf'
      ? t('peerListPanel.pathsPreferRf')
      : activePathSlot?.medium === 'network'
        ? t('peerListPanel.pathsPreferNetwork')
        : '—';

  const openChat = () => {
    const nodeId = reticulumHashToNodeId(peerHash);
    registerReticulumDestinationHash(nodeId, peerHash);
    onSendMessage(nodeId);
    onClose();
  };

  const saveAsContact = useCallback(async () => {
    if (!peer) return;
    setBusy(true);
    try {
      const key = canonicalizeReticulumDestinationHash(peerHash);
      if (!key) {
        console.warn('[ReticulumPeerDetailModal] save contact invalid hash');
        return;
      }
      const label = resolveReticulumPeerLabel(peer, peer.display_name);
      await window.electronAPI.db.upsertReticulumDestination({
        destination_hash: key,
        display_name: label,
        last_heard: Math.floor(Date.now() / 1000),
        is_contact: true,
        favorited: Boolean(peer.favorited),
      });
      registerReticulumDestinationHash(reticulumHashToNodeId(key), key);
      await refreshReticulumPeersFromSidecar();
    } catch (e) {
      console.warn('[ReticulumPeerDetailModal] save contact ' + errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  }, [peer, peerHash]);

  const handleRemoveContact = useCallback(async () => {
    setBusy(true);
    try {
      await removeContact(peerHash);
      setShowRemoveConfirm(false);
      onClose();
    } catch (e) {
      console.warn('[ReticulumPeerDetailModal] remove contact ' + errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  }, [onClose, peerHash, removeContact]);

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
                <ReticulumProfileIconSlot
                  iconName={iconName}
                  iconColor={iconColor}
                  size={20}
                  destinationHash={peerHash}
                />
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
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-gray-400">
              <span className="truncate" title={peerHash}>
                {peerHash}
              </span>
              <span
                className={
                  isContact
                    ? 'bg-readable-green/20 text-readable-green rounded px-1.5 py-0.5 font-sans text-[10px] font-medium'
                    : 'text-muted rounded px-1.5 py-0.5 font-sans text-[10px]'
                }
              >
                {isContact ? t('peerListPanel.contactYes') : t('peerListPanel.contactNo')}
              </span>
              {verified && !verificationMismatch ? (
                <span className="rounded bg-cyan-600/30 px-1.5 py-0.5 font-sans text-[10px] font-medium text-cyan-200">
                  {t('peerDetailModal.verifiedBadge')}
                </span>
              ) : null}
              {verificationMismatch ? (
                <span className="rounded bg-red-900/50 px-1.5 py-0.5 font-sans text-[10px] font-medium text-red-300">
                  {t('peerDetailModal.verifyMismatch')}
                </span>
              ) : null}
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
            <div className="mt-2 space-y-1 rounded border border-gray-700/60 p-2">
              <div className="text-muted text-[10px] tracking-wide uppercase">
                {t('peerDetailModal.verifyFingerprint')}
              </div>
              <div className="font-mono text-xs break-all text-gray-200">{fingerprint}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="rounded bg-cyan-800/60 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-700/60"
                  disabled={!liveIdentityHash || busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      try {
                        await window.electronAPI.db.setReticulumDestinationVerified({
                          destination_hash: peerHash,
                          verified: true,
                          identity_hash: liveIdentityHash,
                        });
                        setVerified(true);
                        setVerifiedIdentityHash(liveIdentityHash);
                      } catch (err) {
                        console.error(
                          '[ReticulumPeerDetailModal] verify failed: ' + errLikeToLogString(err),
                        );
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  {t('peerDetailModal.verifyMark')}
                </button>
                <button
                  type="button"
                  className="rounded bg-slate-700 px-2 py-1 text-xs text-gray-200 hover:bg-slate-600"
                  disabled={!verified || busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      try {
                        await window.electronAPI.db.setReticulumDestinationVerified({
                          destination_hash: peerHash,
                          verified: false,
                        });
                        setVerified(false);
                        setVerifiedIdentityHash(null);
                      } catch (err) {
                        console.error(
                          '[ReticulumPeerDetailModal] revoke verify failed: ' +
                            errLikeToLogString(err),
                        );
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  {t('peerDetailModal.verifyRevoke')}
                </button>
                {contactQrUri ? (
                  <button
                    type="button"
                    className="rounded bg-slate-700 px-2 py-1 text-xs text-gray-200 hover:bg-slate-600"
                    aria-label={t('peerDetailModal.shareContactQrAria')}
                    onClick={() => {
                      setShowContactQr((v) => !v);
                    }}
                  >
                    {t('peerDetailModal.shareContactQr')}
                  </button>
                ) : null}
              </div>
              {showContactQr && contactQrUri ? (
                <div className="pt-2">
                  <QrCodeImage
                    value={contactQrUri}
                    size={160}
                    ariaLabel={t('peerDetailModal.shareContactQrAria')}
                  />
                </div>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="block text-xs text-gray-400" htmlFor="peer-icon-name">
                {t('reticulumProfileIcon.iconName')}
                <select
                  id="peer-icon-name"
                  value={iconName}
                  className="bg-deep-black mt-1 block rounded border border-gray-600 px-2 py-1 text-sm text-gray-200"
                  aria-label={t('reticulumProfileIcon.iconNameAria')}
                  onChange={(e) => {
                    const name = e.target.value as ReticulumProfileIconName;
                    if (name === 'circle') {
                      void saveIconAppearance({ icon_name: 'circle', icon_color: 'green' });
                    } else {
                      void saveIconAppearance({ icon_name: name });
                    }
                  }}
                >
                  <option value="circle">{t('reticulumProfileIcon.iconNone')}</option>
                  <option value="star">{t('reticulumProfileIcon.iconStar')}</option>
                  <option value="heart">{t('reticulumProfileIcon.iconHeart')}</option>
                  <option value="shield">{t('reticulumProfileIcon.iconShield')}</option>
                  <option value="user">{t('reticulumProfileIcon.iconUser')}</option>
                </select>
              </label>
              <label className="block text-xs text-gray-400" htmlFor="peer-icon-color">
                {t('peerDetailModal.iconColor')}
                <select
                  id="peer-icon-color"
                  value={iconColor}
                  className="bg-deep-black mt-1 block rounded border border-gray-600 px-2 py-1 text-sm text-gray-200"
                  aria-label={t('peerDetailModal.iconColorAria')}
                  onChange={(e) => {
                    void saveIconAppearance({ icon_color: e.target.value });
                  }}
                >
                  <option value="green">{t('common.colorGreen')}</option>
                  <option value="cyan">{t('common.colorCyan')}</option>
                  <option value="amber">{t('common.colorAmber')}</option>
                  <option value="red">{t('common.colorRed')}</option>
                  <option value="purple">{t('common.colorPurple')}</option>
                </select>
              </label>
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
            <dt className="text-muted">{t('peerListPanel.pathsMedium')}</dt>
            <dd>{mediumLabel}</dd>
            <dt className="text-muted">{t('peerListPanel.colLastSeen')}</dt>
            <dd>
              {lastSeenMs ? formatRelativeOrIsoDate(lastSeenMs, t, normalizeLastHeardMs) : '—'}
            </dd>
            <dt className="text-muted">{t('peerDetailModal.backupPaths')}</dt>
            <dd>
              {backupPathSlots.length === 0 ? (
                '—'
              ) : (
                <ul className="space-y-1" aria-label={t('peerDetailModal.backupPaths')}>
                  {backupPathSlots.map((slot, index) => (
                    <li
                      key={`${slot.interface_id ?? 'x'}-${slot.via_hash ?? index}-${slot.hops ?? 'h'}`}
                      className="text-gray-300"
                    >
                      <span className="text-gray-400">{t('peerListPanel.pathsBackupBadge')}</span>
                      {' · '}
                      {t('connectionPanel.reticulumPeers.hops')}: {slot.hops ?? '—'}
                      {' · '}
                      {slot.interface ?? '—'}
                      {' · '}
                      {slot.medium === 'rf'
                        ? t('peerListPanel.pathsPreferRf')
                        : slot.medium === 'network'
                          ? t('peerListPanel.pathsPreferNetwork')
                          : '—'}
                    </li>
                  ))}
                </ul>
              )}
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
          {!isContact ? (
            <button
              type="button"
              disabled={busy}
              className="rounded border border-slate-500 px-3 py-1.5 text-sm text-gray-200 hover:bg-slate-800 disabled:opacity-40"
              onClick={() => {
                void saveAsContact();
              }}
            >
              {t('peerDetailModal.saveContact')}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-40"
              onClick={() => {
                setShowRemoveConfirm(true);
              }}
            >
              {t('peerDetailModal.removeContact')}
            </button>
          )}
          {identityId ? (
            isBlocked ? (
              <button
                type="button"
                disabled={busy}
                className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-40"
                onClick={() => {
                  void unblockContact('reticulum', identityId, peerHash);
                }}
              >
                {t('peerDetailModal.unblockContact')}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                className="rounded border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/30 disabled:opacity-40"
                onClick={() => {
                  void blockContact('reticulum', identityId, peerHash);
                }}
              >
                {t('peerDetailModal.blockContact')}
              </button>
            )
          ) : null}
        </section>

        {pathStatus ? <p className="mb-2 text-xs text-gray-300">{pathStatus}</p> : null}
        {probeStatus ? <p className="mb-2 text-xs text-gray-300">{probeStatus}</p> : null}
      </div>
      {showRemoveConfirm ? (
        <ConfirmModal
          title={t('peerDetailModal.removeContactConfirmTitle')}
          message={t('peerDetailModal.removeContactConfirmBody')}
          confirmLabel={t('peerDetailModal.removeContact')}
          danger
          confirmDisabled={busy}
          onConfirm={() => {
            void handleRemoveContact();
          }}
          onCancel={() => {
            if (busy) return;
            setShowRemoveConfirm(false);
          }}
        />
      ) : null}
    </div>
  );
}
