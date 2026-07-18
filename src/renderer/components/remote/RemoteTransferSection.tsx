import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RemotePathCapabilityChip } from '@/renderer/components/remote/RemotePathCapabilityChip';
import { useToast } from '@/renderer/components/Toast';
import { useRemotePathCapability } from '@/renderer/hooks/useRemotePathCapability';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import i18n from '@/renderer/lib/i18n';
import type { RemoteSettings } from '@/renderer/lib/remoteSettingsStorage';
import { parseReticulumDestinationInput } from '@/renderer/lib/reticulum/reticulumDestinationInput';
import { sendRncpRequestEnable } from '@/renderer/lib/sendRncpRequestEnable';
import { useReticulumInboundPolicyStore } from '@/renderer/stores/reticulumInboundPolicyStore';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import {
  DEFAULT_RNCP_MAX_RETRY_ATTEMPTS,
  useRncpTransferStore,
} from '@/renderer/stores/rncpTransferStore';
import { resolveRemoteReasonI18nKey } from '@/shared/remote-types';
import { buildRncpRequestEnableMessageBody } from '@/shared/rncpRequestEnable';

export interface RemoteTransferSectionProps {
  sidecarRunning: boolean;
  settings: RemoteSettings;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Reticulum Remote → Transfer: rncp send/fetch, transfer list, inbound offers. */
export function RemoteTransferSection({ sidecarRunning, settings }: RemoteTransferSectionProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();

  const transfers = useRncpTransferStore((s) => s.transfers);
  const pendingOffers = useRncpTransferStore((s) => s.pendingOffers);
  const startTransfer = useRncpTransferStore((s) => s.startTransfer);
  const removeOffer = useRncpTransferStore((s) => s.removeOffer);
  const incrementRetry = useRncpTransferStore((s) => s.incrementRetry);

  const savedAddresses = useReticulumRemoteAddressStore((s) => s.addresses);
  const rncpAddresses = useMemo(
    () => [...savedAddresses.values()].filter((a) => a.service === 'rncp'),
    [savedAddresses],
  );

  const upsertInboundPolicy = useReticulumInboundPolicyStore((s) => s.upsert);

  const [mode, setMode] = useState<'send' | 'fetch'>('send');
  const [destinationInput, setDestinationInput] = useState('');
  const [remotePath, setRemotePath] = useState('');
  const [pickedFile, setPickedFile] = useState<string | null>(null);
  const [pickedSaveDir, setPickedSaveDir] = useState<string | null>(null);
  const [identity, setIdentity] = useState<{
    identity_hash: string | null;
    rncp_receive_hash: string | null;
  } | null>(null);

  const parsedHash = parseReticulumDestinationInput(destinationInput);
  const { capability, loading: capabilityLoading } = useRemotePathCapability(parsedHash);
  const transferAllowed = capability?.transfer_allowed ?? false;

  useEffect(() => {
    if (!sidecarRunning) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale identity when the sidecar stops
      setIdentity(null);
      return;
    }
    void window.electronAPI.reticulum.remote
      .getIdentity()
      .then(setIdentity)
      .catch((e: unknown) => {
        console.debug('[RemoteTransferSection] getIdentity ' + errLikeToLogString(e));
      });
  }, [sidecarRunning]);

  const transferList = useMemo(
    () => [...transfers.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    [transfers],
  );
  const offerList = useMemo(() => [...pendingOffers.values()], [pendingOffers]);

  const handlePickFile = useCallback(async () => {
    const res = await window.electronAPI.reticulum.rncp.showOpenFileDialog();
    if (!res.canceled && res.path) setPickedFile(res.path);
  }, []);

  const handlePickSaveDir = useCallback(async () => {
    const res = await window.electronAPI.reticulum.rncp.showSaveDirectoryDialog();
    if (!res.canceled && res.path) setPickedSaveDir(res.path);
  }, []);

  const handleSend = useCallback(async () => {
    if (!parsedHash || !pickedFile) return;
    try {
      const res = await window.electronAPI.reticulum.rncp.send({
        destination_hash: parsedHash,
        path: pickedFile,
      });
      if (!res.ok || !res.transfer_id) {
        addToast(
          t('reticulumRemote.transfer.sendFailed', { error: res.error ?? t('common.error') }),
          'error',
        );
        return;
      }
      startTransfer({
        transfer_id: res.transfer_id,
        kind: 'send',
        destination_hash: parsedHash,
        file_name: pickedFile.split(/[/\\]/).pop() ?? pickedFile,
        retryArgs: { path: pickedFile },
      });
      setPickedFile(null);
    } catch (e) {
      console.debug('[RemoteTransferSection] send ' + errLikeToLogString(e));
      addToast(t('reticulumRemote.transfer.sendFailed', { error: errLikeToLogString(e) }), 'error');
    }
  }, [addToast, parsedHash, pickedFile, startTransfer, t]);

  const handleFetch = useCallback(async () => {
    if (!parsedHash || !remotePath.trim()) return;
    try {
      const res = await window.electronAPI.reticulum.rncp.fetch({
        destination_hash: parsedHash,
        remote_path: remotePath.trim(),
        save_path: pickedSaveDir ?? undefined,
      });
      if (!res.ok || !res.transfer_id) {
        addToast(
          t('reticulumRemote.transfer.fetchFailed', { error: res.error ?? t('common.error') }),
          'error',
        );
        return;
      }
      startTransfer({
        transfer_id: res.transfer_id,
        kind: 'fetch',
        destination_hash: parsedHash,
        file_name: remotePath.trim().split(/[/\\]/).pop() ?? remotePath.trim(),
        retryArgs: {
          remote_path: remotePath.trim(),
          save_path: pickedSaveDir ?? undefined,
        },
      });
    } catch (e) {
      console.debug('[RemoteTransferSection] fetch ' + errLikeToLogString(e));
      addToast(
        t('reticulumRemote.transfer.fetchFailed', { error: errLikeToLogString(e) }),
        'error',
      );
    }
  }, [addToast, parsedHash, pickedSaveDir, remotePath, startTransfer, t]);

  const handleCancel = useCallback(async (transferId: string) => {
    try {
      await window.electronAPI.reticulum.rncp.cancel({ transfer_id: transferId });
    } catch (e) {
      console.warn('[RemoteTransferSection] cancel ' + errLikeToLogString(e));
    }
  }, []);

  const maxRetry = settings.maxRetryAttempts ?? DEFAULT_RNCP_MAX_RETRY_ATTEMPTS;

  const handleRetry = useCallback(
    async (transferId: string) => {
      const transfer = transfers.get(transferId);
      if (!transfer?.retryArgs) return;
      incrementRetry(transferId);
      try {
        if ('path' in transfer.retryArgs) {
          const res = await window.electronAPI.reticulum.rncp.send({
            destination_hash: transfer.destination_hash,
            path: transfer.retryArgs.path,
          });
          if (res.ok && res.transfer_id) {
            startTransfer({
              transfer_id: res.transfer_id,
              kind: 'send',
              destination_hash: transfer.destination_hash,
              file_name: transfer.file_name,
              retryArgs: transfer.retryArgs,
            });
          }
        } else {
          const res = await window.electronAPI.reticulum.rncp.fetch({
            destination_hash: transfer.destination_hash,
            remote_path: transfer.retryArgs.remote_path,
            save_path: transfer.retryArgs.save_path,
          });
          if (res.ok && res.transfer_id) {
            startTransfer({
              transfer_id: res.transfer_id,
              kind: 'fetch',
              destination_hash: transfer.destination_hash,
              file_name: transfer.file_name,
              retryArgs: transfer.retryArgs,
            });
          }
        }
      } catch (e) {
        console.warn('[RemoteTransferSection] retry ' + errLikeToLogString(e));
      }
    },
    [incrementRetry, startTransfer, transfers],
  );

  // Auto-retry each failed transfer once per failure, up to the configured cap.
  const autoRetriedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!settings.autoRetryTransfer) return;
    for (const transfer of transferList) {
      if (transfer.status !== 'failed' || !transfer.retryArgs) continue;
      if (transfer.retryCount >= maxRetry) continue;
      if (autoRetriedRef.current.has(transfer.transfer_id)) continue;
      autoRetriedRef.current.add(transfer.transfer_id);
      void handleRetry(transfer.transfer_id);
    }
  }, [transferList, settings.autoRetryTransfer, maxRetry, handleRetry]);

  useEffect(() => {
    const liveIds = new Set(transferList.map((t) => t.transfer_id));
    for (const id of [...autoRetriedRef.current]) {
      if (!liveIds.has(id)) autoRetriedRef.current.delete(id);
    }
  }, [transferList]);

  const handleReveal = useCallback(async (path: string) => {
    try {
      await window.electronAPI.reticulum.rncp.revealInFolder(path);
    } catch (e) {
      console.debug('[RemoteTransferSection] reveal ' + errLikeToLogString(e));
    }
  }, []);

  const handleAcceptOffer = useCallback(
    async (transferId: string) => {
      try {
        await window.electronAPI.reticulum.rncp.accept({ transfer_id: transferId });
        removeOffer(transferId);
      } catch (e) {
        console.debug('[RemoteTransferSection] accept ' + errLikeToLogString(e));
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
        console.warn('[RemoteTransferSection] reject ' + errLikeToLogString(e));
      } finally {
        removeOffer(transferId);
      }
    },
    [removeOffer],
  );

  const handleAlwaysDecision = useCallback(
    async (identityHash: string | null | undefined, decision: 'allow' | 'block') => {
      if (!identityHash) return;
      await upsertInboundPolicy({ identity_hash: identityHash, decision });
      addToast(
        decision === 'allow'
          ? t('reticulumRemote.transfer.alwaysAllowSaved')
          : t('reticulumRemote.transfer.alwaysBlockSaved'),
        'success',
      );
    },
    [addToast, t, upsertInboundPolicy],
  );

  const copy = useCallback(
    (value: string | null | undefined) => {
      if (!value) return;
      void navigator.clipboard.writeText(value).catch((e: unknown) => {
        console.debug('[RemoteTransferSection] clipboard ' + errLikeToLogString(e));
      });
      addToast(t('common.copied'), 'success');
    },
    [addToast, t],
  );

  const handleRequestEnable = useCallback(async () => {
    if (!parsedHash) {
      addToast(t('reticulumRemote.errors.invalidAddress'), 'error');
      return;
    }
    const res = await sendRncpRequestEnable(parsedHash);
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
  }, [addToast, parsedHash, t]);

  const handleCopyInstructions = useCallback(() => {
    const text = buildRncpRequestEnableMessageBody(
      i18n.t('reticulumRemote.enableRequest.lxmfBody'),
    );
    void navigator.clipboard.writeText(text).catch((e: unknown) => {
      console.debug('[RemoteTransferSection] clipboard ' + errLikeToLogString(e));
    });
    addToast(t('reticulumRemote.transfer.instructionsCopied'), 'success');
  }, [addToast, t]);

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-700/60 bg-gray-800/30 p-3">
        <span className="text-xs text-gray-400">{t('reticulumRemote.transfer.myIdentity')}</span>
        <code className="text-xs text-gray-200">{identity?.identity_hash ?? '—'}</code>
        <button
          type="button"
          aria-label={t('reticulumRemote.transfer.copyIdentityAria')}
          className="text-xs text-blue-400 hover:text-blue-300"
          onClick={() => {
            copy(identity?.identity_hash);
          }}
          disabled={!identity?.identity_hash}
        >
          {t('common.copy')}
        </button>
        <span className="text-xs text-gray-400">{t('reticulumRemote.transfer.myReceiveDest')}</span>
        <code className="text-xs text-gray-200">{identity?.rncp_receive_hash ?? '—'}</code>
        <button
          type="button"
          aria-label={t('reticulumRemote.transfer.copyReceiveDestAria')}
          className="text-xs text-blue-400 hover:text-blue-300"
          onClick={() => {
            copy(identity?.rncp_receive_hash);
          }}
          disabled={!identity?.rncp_receive_hash}
        >
          {t('common.copy')}
        </button>
      </div>

      {offerList.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-amber-300">
            {t('reticulumRemote.transfer.pendingOffersTitle')}
          </h3>
          {offerList.map((offer) => (
            <div
              key={offer.transfer_id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-100"
            >
              <span className="min-w-0 flex-1 truncate">
                {t('reticulumRemote.transfer.offerLabel', {
                  file: offer.file_name,
                  bytes: formatBytes(offer.bytes),
                })}
              </span>
              <button
                type="button"
                aria-label={t('reticulumRemote.transfer.acceptAria', { file: offer.file_name })}
                onClick={() => void handleAcceptOffer(offer.transfer_id)}
                className="rounded bg-green-800/60 px-2 py-1 text-green-200 hover:bg-green-800"
              >
                {t('reticulumRemote.transfer.accept')}
              </button>
              <button
                type="button"
                aria-label={t('reticulumRemote.transfer.rejectAria', { file: offer.file_name })}
                onClick={() => void handleRejectOffer(offer.transfer_id)}
                className="rounded bg-red-900/60 px-2 py-1 text-red-200 hover:bg-red-900"
              >
                {t('reticulumRemote.transfer.reject')}
              </button>
              <button
                type="button"
                aria-label={t('reticulumRemote.transfer.alwaysAllowAria', {
                  file: offer.file_name,
                })}
                onClick={() => void handleAlwaysDecision(offer.identity_hash, 'allow')}
                disabled={!offer.identity_hash}
                className="rounded bg-gray-700/60 px-2 py-1 text-gray-200 hover:bg-gray-600 disabled:opacity-40"
              >
                {t('reticulumRemote.transfer.alwaysAllow')}
              </button>
              <button
                type="button"
                aria-label={t('reticulumRemote.transfer.alwaysBlockAria', {
                  file: offer.file_name,
                })}
                onClick={() => void handleAlwaysDecision(offer.identity_hash, 'block')}
                disabled={!offer.identity_hash}
                className="rounded bg-gray-700/60 px-2 py-1 text-gray-200 hover:bg-gray-600 disabled:opacity-40"
              >
                {t('reticulumRemote.transfer.alwaysBlock')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-gray-700/60 p-3">
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={mode === 'send'}
            aria-label={t('reticulumRemote.transfer.modeSendAria')}
            onClick={() => {
              setMode('send');
            }}
            className={`rounded px-3 py-1 text-xs ${
              mode === 'send' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400'
            }`}
          >
            {t('reticulumRemote.transfer.modeSend')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'fetch'}
            aria-label={t('reticulumRemote.transfer.modeFetchAria')}
            onClick={() => {
              setMode('fetch');
            }}
            className={`rounded px-3 py-1 text-xs ${
              mode === 'fetch' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400'
            }`}
          >
            {t('reticulumRemote.transfer.modeFetch')}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={destinationInput}
            onChange={(e) => {
              setDestinationInput(e.target.value);
            }}
            placeholder={t('reticulumRemote.transfer.destinationPlaceholder')}
            aria-label={t('reticulumRemote.transfer.destinationAria')}
            list="reticulum-remote-rncp-addresses"
            className="bg-secondary-dark/80 min-w-[240px] flex-1 rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500/50 focus:outline-none"
          />
          <datalist id="reticulum-remote-rncp-addresses">
            {rncpAddresses.map((addr) => (
              <option key={addr.id} value={addr.destination_hash} label={addr.label} />
            ))}
          </datalist>
          <RemotePathCapabilityChip capability={capability} loading={capabilityLoading} />
          <button
            type="button"
            aria-label={t('reticulumRemote.transfer.requestEnableAria')}
            disabled={!parsedHash || !sidecarRunning}
            onClick={() => void handleRequestEnable()}
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            {t('reticulumRemote.transfer.requestEnable')}
          </button>
          <button
            type="button"
            aria-label={t('reticulumRemote.transfer.copyInstructionsAria')}
            onClick={handleCopyInstructions}
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            {t('reticulumRemote.transfer.copyInstructions')}
          </button>
        </div>
        {capability && !transferAllowed && (
          <p className="text-xs text-amber-300">
            {t('reticulumRemote.transfer.notAllowedHint', {
              reason: capability.reason_key
                ? t(
                    resolveRemoteReasonI18nKey(capability.reason_key) ??
                      'reticulumRemote.reasons.error',
                  )
                : t('reticulumRemote.reasons.error'),
            })}
          </p>
        )}

        {mode === 'send' ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label={t('reticulumRemote.transfer.chooseFileAria')}
              onClick={() => void handlePickFile()}
              className="rounded bg-gray-700/60 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600"
            >
              {t('reticulumRemote.transfer.chooseFile')}
            </button>
            <span className="text-muted min-w-0 flex-1 truncate text-xs">
              {pickedFile ?? t('reticulumRemote.transfer.noFileChosen')}
            </span>
            <button
              type="button"
              disabled={!sidecarRunning || !parsedHash || !pickedFile || !transferAllowed}
              aria-label={t('reticulumRemote.transfer.sendAria')}
              onClick={() => void handleSend()}
              className="rounded bg-blue-700/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {t('reticulumRemote.transfer.send')}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={remotePath}
              onChange={(e) => {
                setRemotePath(e.target.value);
              }}
              placeholder={t('reticulumRemote.transfer.remotePathPlaceholder')}
              aria-label={t('reticulumRemote.transfer.remotePathAria')}
              className="bg-secondary-dark/80 min-w-[200px] flex-1 rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500/50 focus:outline-none"
            />
            <button
              type="button"
              aria-label={t('reticulumRemote.transfer.chooseSaveDirAria')}
              onClick={() => void handlePickSaveDir()}
              className="rounded bg-gray-700/60 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600"
            >
              {t('reticulumRemote.transfer.chooseSaveDir')}
            </button>
            <span className="text-muted min-w-0 flex-1 truncate text-xs">
              {pickedSaveDir ?? t('reticulumRemote.transfer.defaultSaveDir')}
            </span>
            <button
              type="button"
              disabled={!sidecarRunning || !parsedHash || !remotePath.trim() || !transferAllowed}
              aria-label={t('reticulumRemote.transfer.fetchAria')}
              onClick={() => void handleFetch()}
              className="rounded bg-blue-700/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {t('reticulumRemote.transfer.fetch')}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-300">
          {t('reticulumRemote.transfer.listTitle')}
        </h3>
        {transferList.length === 0 ? (
          <p className="text-muted text-xs">{t('reticulumRemote.transfer.listEmpty')}</p>
        ) : (
          transferList.map((transfer) => (
            <div
              key={transfer.transfer_id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-700/60 bg-gray-800/30 px-3 py-2 text-xs text-gray-200"
            >
              <span className="min-w-0 flex-1 truncate">
                {t(`reticulumRemote.transfer.kind.${transfer.kind}`)} · {transfer.file_name ?? '—'}
              </span>
              <span className="text-muted">{formatBytes(transfer.bytes)}</span>
              <span
                className={`rounded px-1.5 py-0.5 ${
                  transfer.status === 'completed'
                    ? 'bg-green-900/40 text-green-300'
                    : transfer.status === 'failed'
                      ? 'bg-red-900/40 text-red-300'
                      : transfer.status === 'cancelled'
                        ? 'bg-gray-700/60 text-gray-300'
                        : 'bg-blue-900/40 text-blue-300'
                }`}
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
                  className="rounded bg-red-900/50 px-2 py-1 text-red-300 hover:bg-red-900/70"
                >
                  {t('reticulumRemote.transfer.cancel')}
                </button>
              )}
              {transfer.status === 'failed' &&
                transfer.retryArgs &&
                transfer.retryCount < maxRetry && (
                  <button
                    type="button"
                    aria-label={t('reticulumRemote.transfer.retryAria', {
                      file: transfer.file_name ?? '',
                    })}
                    onClick={() => void handleRetry(transfer.transfer_id)}
                    className="rounded bg-gray-700/60 px-2 py-1 text-gray-200 hover:bg-gray-600"
                  >
                    {t('reticulumRemote.transfer.retry')}
                  </button>
                )}
              {transfer.path && (
                <button
                  type="button"
                  aria-label={t('reticulumRemote.transfer.revealAria', {
                    file: transfer.file_name ?? '',
                  })}
                  onClick={() => void handleReveal(transfer.path!)}
                  className="rounded bg-gray-700/60 px-2 py-1 text-gray-200 hover:bg-gray-600"
                >
                  {t('reticulumRemote.transfer.reveal')}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
