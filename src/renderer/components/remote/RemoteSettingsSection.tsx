import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { RemoteSettings } from '@/renderer/lib/remoteSettingsStorage';
import { policiesToRncpLists } from '@/renderer/lib/rncpInboundPolicyLists';
import {
  inboundModeFromListenerStatus,
  isRncpPickerAllowlistError,
} from '@/renderer/lib/rncpListenerApply';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';
import { useReticulumInboundPolicyStore } from '@/renderer/stores/reticulumInboundPolicyStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';
import { isRemoteOkFailure, type RncpInboundMode } from '@/shared/remote-types';

import { chipClass } from '../ui/formClasses';

/** Sidecar outbound + inbound hard cap (see `MAX_RNCP_FILE_BYTES` in rncp_transfer.rs). */
export const RNCP_MAX_FILE_SIZE_LABEL = '25 MiB';

export interface RemoteSettingsSectionProps {
  sidecarRunning: boolean;
  settings: RemoteSettings;
  onSettingsChange: (patch: Partial<RemoteSettings>) => void;
}

/** Reticulum Remote → Settings: inbound policy, retry/reconnect prefs, identity copy. */
export function RemoteSettingsSection({
  sidecarRunning,
  settings,
  onSettingsChange,
}: Readonly<RemoteSettingsSectionProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();

  const listener = useRncpTransferStore((s) => s.listener);
  const setListener = useRncpTransferStore((s) => s.setListener);

  const policies = useReticulumInboundPolicyStore((s) => s.policies);
  const hydratePolicies = useReticulumInboundPolicyStore((s) => s.hydrate);
  const removePolicy = useReticulumInboundPolicyStore((s) => s.remove);

  const [allowFetch, setAllowFetch] = useState(settings.allowFetch);
  const [fetchJail, setFetchJail] = useState<string | null>(settings.lastFetchJail);
  const [saveDir, setSaveDir] = useState<string | null>(settings.lastSaveDir);
  const [overwrite, setOverwrite] = useState(settings.overwriteOnReceive);
  const [identity, setIdentity] = useState<{
    identity_hash: string | null;
    rncp_receive_hash: string | null;
  } | null>(null);

  const refreshListener = useCallback(async () => {
    if (!sidecarRunning) return;
    try {
      const status = await window.electronAPI.reticulum.rncp.getListener();
      setListener(status);
      return status;
    } catch (e) {
      console.debug('[RemoteSettingsSection] getListener ' + errLikeToLogString(e));
      return null;
    }
  }, [setListener, sidecarRunning]);

  const syncInboundModeFromListener = useCallback(async () => {
    const status = await refreshListener();
    if (!status) return;
    onSettingsChange({ inboundMode: inboundModeFromListenerStatus(status) });
  }, [onSettingsChange, refreshListener]);

  useEffect(() => {
    void refreshListener();
    void hydratePolicies();
  }, [refreshListener, hydratePolicies]);

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
        console.debug('[RemoteSettingsSection] getIdentity ' + errLikeToLogString(e));
      });
  }, [sidecarRunning]);

  const pickSaveDir = useCallback(async (): Promise<string | null> => {
    const picked = await window.electronAPI.reticulum.rncp.showSaveDirectoryDialog();
    if (picked.canceled || !picked.path) return null;
    setSaveDir(picked.path);
    return picked.path;
  }, []);

  const pickFetchJail = useCallback(async (): Promise<string | null> => {
    const picked = await window.electronAPI.reticulum.rncp.showSaveDirectoryDialog();
    if (picked.canceled || !picked.path) return null;
    setFetchJail(picked.path);
    return picked.path;
  }, []);

  const applyListener = useCallback(
    async (mode: RncpInboundMode) => {
      if (mode === 'off') {
        try {
          const res = await window.electronAPI.reticulum.rncp.setListener({
            enabled: false,
          });
          if (isRemoteOkFailure(res)) {
            addToast(
              t('reticulumRemote.settings.applyFailed', { error: res.error ?? '' }),
              'error',
            );
            await syncInboundModeFromListener();
            return;
          }
          onSettingsChange({ inboundMode: 'off' });
          await refreshListener();
        } catch (e) {
          console.debug('[RemoteSettingsSection] apply ' + errLikeToLogString(e));
          addToast(
            t('reticulumRemote.settings.applyFailed', { error: errLikeToLogString(e) }),
            'error',
          );
          await syncInboundModeFromListener();
        }
        return;
      }

      if (allowFetch && !fetchJail) {
        addToast(t('reticulumRemote.settings.fetchJailRequired'), 'error');
        return;
      }

      let dir = saveDir;
      if (!dir) {
        dir = await pickSaveDir();
        if (!dir) {
          addToast(t('reticulumRemote.enableRequest.saveDirRequired'), 'info');
          return;
        }
      }

      let jail = fetchJail;
      const { allowed, blocked } = policiesToRncpLists(policies);

      const trySet = async (save_dir: string, fetch_jail: string | null) =>
        window.electronAPI.reticulum.rncp.setListener({
          enabled: true,
          save_dir,
          allow_fetch: allowFetch,
          fetch_jail: fetch_jail ?? undefined,
          overwrite,
          allowed,
          blocked,
        });

      try {
        let res = await trySet(dir, jail);
        if (isRemoteOkFailure(res) && isRncpPickerAllowlistError(res.error)) {
          addToast(t('reticulumRemote.settings.rechooseSaveDir'), 'info');
          // Re-authorize dirs from this session's picker — persisted paths are rejected after restart.
          const rePicked = await pickSaveDir();
          if (!rePicked) {
            await syncInboundModeFromListener();
            return;
          }
          dir = rePicked;
          if (allowFetch) {
            const reJail = await pickFetchJail();
            if (!reJail) {
              addToast(t('reticulumRemote.settings.fetchJailRequired'), 'error');
              await syncInboundModeFromListener();
              return;
            }
            jail = reJail;
          }
          res = await trySet(dir, jail);
        }

        if (isRemoteOkFailure(res)) {
          const err = res.error ?? '';
          addToast(
            isRncpPickerAllowlistError(err)
              ? t('reticulumRemote.settings.rechooseSaveDir')
              : t('reticulumRemote.settings.applyFailed', { error: err }),
            'error',
          );
          await syncInboundModeFromListener();
          return;
        }

        onSettingsChange({
          inboundMode: mode,
          lastSaveDir: dir,
          ...(jail != null ? { lastFetchJail: jail } : {}),
        });
        await refreshListener();
      } catch (e) {
        console.debug('[RemoteSettingsSection] apply ' + errLikeToLogString(e));
        addToast(
          t('reticulumRemote.settings.applyFailed', { error: errLikeToLogString(e) }),
          'error',
        );
        await syncInboundModeFromListener();
      }
    },
    [
      addToast,
      allowFetch,
      fetchJail,
      onSettingsChange,
      overwrite,
      pickFetchJail,
      pickSaveDir,
      policies,
      refreshListener,
      saveDir,
      syncInboundModeFromListener,
      t,
    ],
  );

  const pushPolicyListsToSidecar = useCallback(async () => {
    if (!sidecarRunning || !listener?.enabled || !saveDir) return;
    if (allowFetch && !fetchJail) return;
    const { allowed, blocked } = policiesToRncpLists(
      useReticulumInboundPolicyStore.getState().policies,
    );
    try {
      let dir = saveDir;
      let jail = fetchJail;
      let res = await window.electronAPI.reticulum.rncp.setListener({
        enabled: true,
        save_dir: dir,
        allow_fetch: allowFetch,
        fetch_jail: jail ?? undefined,
        overwrite,
        allowed,
        blocked,
      });
      if (isRemoteOkFailure(res) && isRncpPickerAllowlistError(res.error)) {
        addToast(t('reticulumRemote.settings.rechooseSaveDir'), 'info');
        const rePicked = await pickSaveDir();
        if (!rePicked) {
          await syncInboundModeFromListener();
          return;
        }
        dir = rePicked;
        if (allowFetch) {
          const reJail = await pickFetchJail();
          if (!reJail) {
            addToast(t('reticulumRemote.settings.fetchJailRequired'), 'error');
            await syncInboundModeFromListener();
            return;
          }
          jail = reJail;
        }
        res = await window.electronAPI.reticulum.rncp.setListener({
          enabled: true,
          save_dir: dir,
          allow_fetch: allowFetch,
          fetch_jail: jail ?? undefined,
          overwrite,
          allowed,
          blocked,
        });
      }
      if (isRemoteOkFailure(res)) {
        console.warn('[RemoteSettingsSection] pushPolicy ' + (res.error ?? ''));
        if (isRncpPickerAllowlistError(res.error)) {
          addToast(t('reticulumRemote.settings.rechooseSaveDir'), 'error');
        }
        await syncInboundModeFromListener();
        return;
      }
      onSettingsChange({
        lastSaveDir: dir,
        ...(jail != null ? { lastFetchJail: jail } : {}),
      });
      await refreshListener();
    } catch (e) {
      console.warn('[RemoteSettingsSection] pushPolicy ' + errLikeToLogString(e));
    }
  }, [
    addToast,
    allowFetch,
    fetchJail,
    listener?.enabled,
    onSettingsChange,
    overwrite,
    pickFetchJail,
    pickSaveDir,
    refreshListener,
    saveDir,
    sidecarRunning,
    syncInboundModeFromListener,
    t,
  ]);

  const handleRemovePolicy = useCallback(
    async (identityHash: string) => {
      await removePolicy(identityHash);
      await pushPolicyListsToSidecar();
    },
    [pushPolicyListsToSidecar, removePolicy],
  );

  const handlePickFetchJail = useCallback(() => {
    void (async () => {
      const path = await pickFetchJail();
      if (path) {
        onSettingsChange({ lastFetchJail: path });
      }
    })();
  }, [onSettingsChange, pickFetchJail]);

  const handlePickSaveDir = useCallback(async () => {
    const path = await pickSaveDir();
    if (path) {
      onSettingsChange({ lastSaveDir: path });
    }
  }, [onSettingsChange, pickSaveDir]);

  // Keep local fields in sync when parent reloads settings from storage.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror persisted Remote settings into local form state
    setSaveDir(settings.lastSaveDir);
  }, [settings.lastSaveDir]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror persisted Remote settings into local form state
    setFetchJail(settings.lastFetchJail);
  }, [settings.lastFetchJail]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror persisted Remote settings into local form state
    setAllowFetch(settings.allowFetch);
  }, [settings.allowFetch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror persisted Remote settings into local form state
    setOverwrite(settings.overwriteOnReceive);
  }, [settings.overwriteOnReceive]);

  const copy = useCallback(
    (value: string | null | undefined) => {
      if (!value) return;
      void writeClipboardText(value).catch((e: unknown) => {
        console.debug('[RemoteSettingsSection] clipboard ' + errLikeToLogString(e));
      });
      addToast(t('common.copied'), 'success');
    },
    [addToast, t],
  );

  const announceReceiveDest = useCallback(async () => {
    if (!sidecarRunning || !listener?.enabled) {
      addToast(t('reticulumRemote.settings.announceReceiveDestListenerOff'), 'info');
      return;
    }
    try {
      const res = await window.electronAPI.reticulum.rncp.announce();
      if (!res.ok) {
        addToast(
          t('reticulumRemote.settings.announceReceiveDestFailed', {
            error: res.error ?? t('common.error'),
          }),
          'error',
        );
        return;
      }
      addToast(t('reticulumRemote.settings.announceReceiveDestDone'), 'success');
    } catch (e) {
      console.debug('[RemoteSettingsSection] announce ' + errLikeToLogString(e));
      addToast(
        t('reticulumRemote.settings.announceReceiveDestFailed', {
          error: errLikeToLogString(e),
        }),
        'error',
      );
    }
  }, [addToast, listener?.enabled, sidecarRunning, t]);

  const policyList = [...policies.values()].sort((a, b) => b.updated_at - a.updated_at);

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-y-auto p-3">
      <section className="border-ink-700/60 space-y-2 rounded-lg border p-3">
        <h3 className="text-ink-300 text-sm font-medium">
          {t('reticulumRemote.settings.inboundTitle')}
        </h3>
        <div data-setting-anchor="remote.inbound.mode" className="flex gap-2">
          {(['off', 'ask'] as RncpInboundMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={listener?.inbound_mode === mode}
              aria-label={t(`reticulumRemote.settings.inboundMode.${mode}`)}
              disabled={!sidecarRunning}
              onClick={() => void applyListener(mode)}
              className={`${chipClass(listener?.inbound_mode === mode)} disabled:opacity-50`}
            >
              {t(`reticulumRemote.settings.inboundMode.${mode}`)}
            </button>
          ))}
        </div>

        <div
          data-setting-anchor="remote.inbound.saveDir"
          className="flex flex-wrap items-center gap-2"
        >
          <button
            type="button"
            aria-label={t('reticulumRemote.settings.chooseSaveDirAria')}
            onClick={() => void handlePickSaveDir()}
            className="bg-ink-700/60 text-ink-200 hover:bg-ink-600 rounded px-3 py-1.5 text-xs"
          >
            {t('reticulumRemote.settings.chooseSaveDir')}
          </button>
          <span className="text-muted text-xs">
            {saveDir ?? t('reticulumRemote.settings.noSaveDir')}
          </span>
        </div>

        <label
          data-setting-anchor="remote.inbound.allowFetch"
          className="text-ink-300 flex items-center gap-2 text-xs"
        >
          <input
            type="checkbox"
            checked={allowFetch}
            onChange={(e) => {
              setAllowFetch(e.target.checked);
            }}
            aria-label={t('reticulumRemote.settings.allowFetch')}
            className="accent-brand-green"
          />
          {t('reticulumRemote.settings.allowFetch')}
        </label>
        {allowFetch && (
          <div
            data-setting-anchor="remote.inbound.fetchJail"
            className="flex flex-wrap items-center gap-2"
          >
            <button
              type="button"
              aria-label={t('reticulumRemote.settings.chooseFetchJailAria')}
              onClick={() => {
                handlePickFetchJail();
              }}
              className="bg-ink-700/60 text-ink-200 hover:bg-ink-600 rounded px-3 py-1.5 text-xs"
            >
              {t('reticulumRemote.settings.chooseFetchJail')}
            </button>
            <span className="text-muted text-xs">
              {fetchJail ?? t('reticulumRemote.settings.noFetchJail')}
            </span>
          </div>
        )}
        <label
          data-setting-anchor="remote.inbound.overwrite"
          className="text-ink-300 flex items-center gap-2 text-xs"
        >
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => {
              setOverwrite(e.target.checked);
            }}
            aria-label={t('reticulumRemote.settings.overwrite')}
            className="accent-brand-green"
          />
          {t('reticulumRemote.settings.overwrite')}
        </label>
        <p className="text-muted text-xs">
          {t('reticulumRemote.settings.maxSizeInfo', { size: RNCP_MAX_FILE_SIZE_LABEL })}
        </p>
      </section>

      <section
        data-setting-anchor="remote.access.allowBlockList"
        className="border-ink-700/60 space-y-2 rounded-lg border p-3"
      >
        <h3 className="text-ink-300 text-sm font-medium">
          {t('reticulumRemote.settings.allowBlockListTitle')}
        </h3>
        {policyList.length === 0 ? (
          <p className="text-muted text-xs">{t('reticulumRemote.settings.allowBlockListEmpty')}</p>
        ) : (
          policyList.map((p) => (
            <div
              key={p.identity_hash}
              className="border-ink-700/60 bg-ink-800/30 text-ink-200 flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-xs"
            >
              <span
                className={`rounded px-1.5 py-0.5 ${
                  p.decision === 'allow'
                    ? 'bg-green-900/40 text-green-300'
                    : 'bg-red-900/40 text-red-300'
                }`}
              >
                {t(`reticulumRemote.settings.decision.${p.decision}`)}
              </span>
              <code className="min-w-0 flex-1 truncate">{p.label ?? p.identity_hash}</code>
              <button
                type="button"
                aria-label={t('reticulumRemote.settings.removePolicyAria', {
                  label: p.label ?? p.identity_hash,
                })}
                onClick={() => void handleRemovePolicy(p.identity_hash)}
                className="bg-ink-700/60 text-ink-200 hover:bg-ink-600 rounded px-2 py-1"
              >
                {t('common.delete')}
              </button>
            </div>
          ))
        )}
      </section>

      <section className="border-ink-700/60 space-y-2 rounded-lg border p-3">
        <h3 className="text-ink-300 text-sm font-medium">
          {t('reticulumRemote.settings.reliabilityTitle')}
        </h3>
        <label
          data-setting-anchor="remote.reliability.autoReconnectShell"
          className="text-ink-300 flex items-center gap-2 text-xs"
        >
          <input
            type="checkbox"
            checked={settings.autoReconnectShell}
            onChange={(e) => {
              onSettingsChange({ autoReconnectShell: e.target.checked });
            }}
            aria-label={t('reticulumRemote.settings.autoReconnectShell')}
            className="accent-brand-green"
          />
          {t('reticulumRemote.settings.autoReconnectShell')}
        </label>
        <label
          data-setting-anchor="remote.reliability.autoRetryTransfer"
          className="text-ink-300 flex items-center gap-2 text-xs"
        >
          <input
            type="checkbox"
            checked={settings.autoRetryTransfer}
            onChange={(e) => {
              onSettingsChange({ autoRetryTransfer: e.target.checked });
            }}
            aria-label={t('reticulumRemote.settings.autoRetryTransfer')}
            className="accent-brand-green"
          />
          {t('reticulumRemote.settings.autoRetryTransfer')}
        </label>
      </section>

      <section className="border-ink-700/60 space-y-2 rounded-lg border p-3">
        <h3 className="text-ink-300 text-sm font-medium">
          {t('reticulumRemote.settings.identityTitle')}
        </h3>
        <div className="text-ink-300 flex flex-wrap items-center gap-2 text-xs">
          <span>{t('reticulumRemote.settings.myIdentity')}</span>
          <code className="min-w-0 flex-1 truncate">{identity?.identity_hash ?? '—'}</code>
          <button
            type="button"
            aria-label={t('common.copy')}
            disabled={!identity?.identity_hash}
            onClick={() => {
              copy(identity?.identity_hash);
            }}
            className="bg-ink-700/60 text-ink-200 hover:bg-ink-600 rounded px-2 py-1 disabled:opacity-40"
          >
            {t('common.copy')}
          </button>
        </div>
        <div className="text-ink-300 flex flex-wrap items-center gap-2 text-xs">
          <span>{t('reticulumRemote.transfer.myReceiveDest')}</span>
          <code className="min-w-0 flex-1 truncate">{identity?.rncp_receive_hash ?? '—'}</code>
          <button
            type="button"
            aria-label={t('common.copy')}
            disabled={!identity?.rncp_receive_hash}
            onClick={() => {
              copy(identity?.rncp_receive_hash);
            }}
            className="bg-ink-700/60 text-ink-200 hover:bg-ink-600 rounded px-2 py-1 disabled:opacity-40"
          >
            {t('common.copy')}
          </button>
        </div>
        <button
          type="button"
          data-setting-anchor="remote.identity.announceReceiveDest"
          aria-label={t('reticulumRemote.settings.announceReceiveDestAria')}
          disabled={!sidecarRunning || !listener?.enabled}
          onClick={() => {
            void announceReceiveDest();
          }}
          className="bg-ink-700/60 text-ink-200 hover:bg-ink-600 rounded px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {t('reticulumRemote.settings.announceReceiveDest')}
        </button>
      </section>
    </div>
  );
}
