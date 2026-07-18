import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { RemoteSettings } from '@/renderer/lib/remoteSettingsStorage';
import { policiesToRncpLists } from '@/renderer/lib/rncpInboundPolicyLists';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';
import { useReticulumInboundPolicyStore } from '@/renderer/stores/reticulumInboundPolicyStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';
import type { RncpInboundMode } from '@/shared/remote-types';

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
}: RemoteSettingsSectionProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();

  const listener = useRncpTransferStore((s) => s.listener);
  const setListener = useRncpTransferStore((s) => s.setListener);
  const setInboundModeOptimistic = useRncpTransferStore((s) => s.setInboundModeOptimistic);

  const policies = useReticulumInboundPolicyStore((s) => s.policies);
  const hydratePolicies = useReticulumInboundPolicyStore((s) => s.hydrate);
  const removePolicy = useReticulumInboundPolicyStore((s) => s.remove);

  const [allowFetch, setAllowFetch] = useState(false);
  const [fetchJail, setFetchJail] = useState<string | null>(null);
  const [saveDir, setSaveDir] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [identity, setIdentity] = useState<{
    identity_hash: string | null;
    rncp_receive_hash: string | null;
  } | null>(null);

  const refreshListener = useCallback(async () => {
    if (!sidecarRunning) return;
    try {
      const status = await window.electronAPI.reticulum.rncp.getListener();
      setListener(status);
    } catch (e) {
      console.debug('[RemoteSettingsSection] getListener ' + errLikeToLogString(e));
    }
  }, [setListener, sidecarRunning]);

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

  const applyListener = useCallback(
    async (mode: RncpInboundMode) => {
      if (mode !== 'off') {
        if (allowFetch && !fetchJail) {
          addToast(t('reticulumRemote.settings.fetchJailRequired'), 'error');
          return;
        }
        let dir = saveDir;
        if (!dir) {
          const picked = await window.electronAPI.reticulum.rncp.showSaveDirectoryDialog();
          if (picked.canceled || !picked.path) {
            addToast(t('reticulumRemote.enableRequest.saveDirRequired'), 'info');
            return;
          }
          dir = picked.path;
          setSaveDir(dir);
        }
        setInboundModeOptimistic(mode);
        onSettingsChange({ inboundMode: mode });
        const { allowed, blocked } = policiesToRncpLists(policies);
        try {
          const res = await window.electronAPI.reticulum.rncp.setListener({
            enabled: true,
            save_dir: dir,
            allow_fetch: allowFetch,
            fetch_jail: fetchJail ?? undefined,
            overwrite,
            allowed,
            blocked,
          });
          if (!res.ok) {
            addToast(
              t('reticulumRemote.settings.applyFailed', { error: res.error ?? '' }),
              'error',
            );
          }
          await refreshListener();
        } catch (e) {
          console.debug('[RemoteSettingsSection] apply ' + errLikeToLogString(e));
          addToast(
            t('reticulumRemote.settings.applyFailed', { error: errLikeToLogString(e) }),
            'error',
          );
        }
        return;
      }

      setInboundModeOptimistic(mode);
      onSettingsChange({ inboundMode: mode });
      try {
        const res = await window.electronAPI.reticulum.rncp.setListener({
          enabled: false,
        });
        if (!res.ok) {
          addToast(t('reticulumRemote.settings.applyFailed', { error: res.error ?? '' }), 'error');
        }
        await refreshListener();
      } catch (e) {
        console.debug('[RemoteSettingsSection] apply ' + errLikeToLogString(e));
        addToast(
          t('reticulumRemote.settings.applyFailed', { error: errLikeToLogString(e) }),
          'error',
        );
      }
    },
    [
      addToast,
      allowFetch,
      fetchJail,
      onSettingsChange,
      overwrite,
      policies,
      refreshListener,
      saveDir,
      setInboundModeOptimistic,
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
      await window.electronAPI.reticulum.rncp.setListener({
        enabled: true,
        save_dir: saveDir,
        allow_fetch: allowFetch,
        fetch_jail: fetchJail ?? undefined,
        overwrite,
        allowed,
        blocked,
      });
      await refreshListener();
    } catch (e) {
      console.warn('[RemoteSettingsSection] pushPolicy ' + errLikeToLogString(e));
    }
  }, [
    allowFetch,
    fetchJail,
    listener?.enabled,
    overwrite,
    refreshListener,
    saveDir,
    sidecarRunning,
  ]);

  const handleRemovePolicy = useCallback(
    async (identityHash: string) => {
      await removePolicy(identityHash);
      await pushPolicyListsToSidecar();
    },
    [pushPolicyListsToSidecar, removePolicy],
  );

  const handlePickFetchJail = useCallback(async () => {
    const res = await window.electronAPI.reticulum.rncp.showSaveDirectoryDialog();
    if (!res.canceled && res.path) setFetchJail(res.path);
  }, []);

  const handlePickSaveDir = useCallback(async () => {
    const res = await window.electronAPI.reticulum.rncp.showSaveDirectoryDialog();
    if (!res.canceled && res.path) setSaveDir(res.path);
  }, []);

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

  const policyList = [...policies.values()].sort((a, b) => b.updated_at - a.updated_at);

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-y-auto p-3">
      <section className="space-y-2 rounded-lg border border-gray-700/60 p-3">
        <h3 className="text-sm font-medium text-gray-300">
          {t('reticulumRemote.settings.inboundTitle')}
        </h3>
        <div className="flex gap-2">
          {(['off', 'ask'] as RncpInboundMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={listener?.inbound_mode === mode}
              aria-label={t(`reticulumRemote.settings.inboundMode.${mode}`)}
              disabled={!sidecarRunning}
              onClick={() => void applyListener(mode)}
              className={`rounded px-3 py-1 text-xs disabled:opacity-50 ${
                listener?.inbound_mode === mode
                  ? 'bg-blue-700 text-white'
                  : 'bg-gray-800 text-gray-400'
              }`}
            >
              {t(`reticulumRemote.settings.inboundMode.${mode}`)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label={t('reticulumRemote.settings.chooseSaveDirAria')}
            onClick={() => void handlePickSaveDir()}
            className="rounded bg-gray-700/60 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600"
          >
            {t('reticulumRemote.settings.chooseSaveDir')}
          </button>
          <span className="text-muted text-xs">
            {saveDir ?? t('reticulumRemote.settings.noSaveDir')}
          </span>
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-300">
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label={t('reticulumRemote.settings.chooseFetchJailAria')}
              onClick={() => void handlePickFetchJail()}
              className="rounded bg-gray-700/60 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600"
            >
              {t('reticulumRemote.settings.chooseFetchJail')}
            </button>
            <span className="text-muted text-xs">
              {fetchJail ?? t('reticulumRemote.settings.noFetchJail')}
            </span>
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-gray-300">
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

      <section className="space-y-2 rounded-lg border border-gray-700/60 p-3">
        <h3 className="text-sm font-medium text-gray-300">
          {t('reticulumRemote.settings.allowBlockListTitle')}
        </h3>
        {policyList.length === 0 ? (
          <p className="text-muted text-xs">{t('reticulumRemote.settings.allowBlockListEmpty')}</p>
        ) : (
          policyList.map((p) => (
            <div
              key={p.identity_hash}
              className="flex flex-wrap items-center gap-2 rounded border border-gray-700/60 bg-gray-800/30 px-2 py-1.5 text-xs text-gray-200"
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
                className="rounded bg-gray-700/60 px-2 py-1 text-gray-200 hover:bg-gray-600"
              >
                {t('common.delete')}
              </button>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-gray-700/60 p-3">
        <h3 className="text-sm font-medium text-gray-300">
          {t('reticulumRemote.settings.reliabilityTitle')}
        </h3>
        <label className="flex items-center gap-2 text-xs text-gray-300">
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
        <label className="flex items-center gap-2 text-xs text-gray-300">
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

      <section className="space-y-2 rounded-lg border border-gray-700/60 p-3">
        <h3 className="text-sm font-medium text-gray-300">
          {t('reticulumRemote.settings.identityTitle')}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
          <span>{t('reticulumRemote.settings.myIdentity')}</span>
          <code className="min-w-0 flex-1 truncate">{identity?.identity_hash ?? '—'}</code>
          <button
            type="button"
            aria-label={t('common.copy')}
            disabled={!identity?.identity_hash}
            onClick={() => {
              copy(identity?.identity_hash);
            }}
            className="rounded bg-gray-700/60 px-2 py-1 text-gray-200 hover:bg-gray-600 disabled:opacity-40"
          >
            {t('common.copy')}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
          <span>{t('reticulumRemote.transfer.myReceiveDest')}</span>
          <code className="min-w-0 flex-1 truncate">{identity?.rncp_receive_hash ?? '—'}</code>
          <button
            type="button"
            aria-label={t('common.copy')}
            disabled={!identity?.rncp_receive_hash}
            onClick={() => {
              copy(identity?.rncp_receive_hash);
            }}
            className="rounded bg-gray-700/60 px-2 py-1 text-gray-200 hover:bg-gray-600 disabled:opacity-40"
          >
            {t('common.copy')}
          </button>
        </div>
      </section>
    </div>
  );
}
