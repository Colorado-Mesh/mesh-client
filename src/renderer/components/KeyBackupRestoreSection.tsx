/* eslint-disable react-hooks/set-state-in-effect */
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { nodeNumDisplayHex, publicKeyPrefixHex } from '@/renderer/lib/keyBackupBytes';
import type { MeshcoreKeyBackupIndexEntry } from '@/renderer/lib/meshcoreKeyBackupStorage';
import {
  deleteMeshcoreKeyBackup,
  formatMeshcoreBackupDetail,
  hasMeshcoreKeyBackup,
  listMeshcoreKeyBackups,
  loadMeshcoreKeyBackup,
  saveMeshcoreKeyBackup,
} from '@/renderer/lib/meshcoreKeyBackupStorage';
import type { MeshtasticDmKeyBackupIndexEntry } from '@/renderer/lib/meshtasticDmKeyBackupStorage';
import {
  deleteMeshtasticDmKeyBackup,
  formatMeshtasticBackupDetail,
  hasMeshtasticDmKeyBackup,
  listMeshtasticDmKeyBackups,
  loadMeshtasticDmKeyBackup,
  migrateLegacyMeshtasticDmKeyBackup,
  saveMeshtasticDmKeyBackup,
} from '@/renderer/lib/meshtasticDmKeyBackupStorage';

import { ConfirmModal } from './ConfirmModal';

type BackupIndexEntry = MeshtasticDmKeyBackupIndexEntry | MeshcoreKeyBackupIndexEntry;

function entryNodeKey(entry: BackupIndexEntry, protocol: 'meshtastic' | 'meshcore'): number {
  return protocol === 'meshtastic'
    ? (entry as MeshtasticDmKeyBackupIndexEntry).nodeNum
    : (entry as MeshcoreKeyBackupIndexEntry).nodeId;
}

function formatEntryLabel(
  entry: BackupIndexEntry,
  protocol: 'meshtastic' | 'meshcore',
  t: TFunction,
): string {
  const detail =
    protocol === 'meshtastic'
      ? formatMeshtasticBackupDetail(entry as MeshtasticDmKeyBackupIndexEntry)
      : formatMeshcoreBackupDetail(entry as MeshcoreKeyBackupIndexEntry);
  return protocol === 'meshtastic'
    ? t('securityPanel.backupLabelMeshtastic', { detail })
    : t('securityPanel.backupLabelMeshcore', { detail });
}

export interface KeyBackupRestoreSectionProps {
  protocol: 'meshtastic' | 'meshcore';
  disabled: boolean;
  safeStorageAvailable: boolean | null;
  localNodeKey: number | null | undefined;
  localNodeLabel?: string;
  canBackup: boolean;
  onMeshtasticRestore: (publicKey: Uint8Array, privateKey: Uint8Array) => Promise<boolean>;
  onMeshcoreRestore: (publicKey: Uint8Array, privateKey: Uint8Array) => Promise<boolean>;
  onMeshtasticBackup: () => Promise<{ publicKey: Uint8Array; privateKey: Uint8Array } | null>;
  onMeshcoreBackup: () => Promise<{ publicKey: Uint8Array; privateKey: Uint8Array } | null>;
  addToast: (message: string, type: 'success' | 'error' | 'warning') => void;
}

export function KeyBackupRestoreSection({
  protocol,
  disabled,
  safeStorageAvailable,
  localNodeKey,
  localNodeLabel,
  canBackup,
  onMeshtasticRestore,
  onMeshcoreRestore,
  onMeshtasticBackup,
  onMeshcoreBackup,
  addToast,
}: KeyBackupRestoreSectionProps) {
  const { t } = useTranslation();
  const [backupInProgress, setBackupInProgress] = useState(false);
  const [backupAvailable, setBackupAvailable] = useState(false);
  const [indexRevision, setIndexRevision] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingRestoreKey, setPendingRestoreKey] = useState<number | null>(null);
  const [removeConfirmKey, setRemoveConfirmKey] = useState<number | null>(null);

  const nodeDisplayLabel =
    localNodeLabel?.trim() || (localNodeKey != null ? `!${nodeNumDisplayHex(localNodeKey)}` : '');

  const refreshBackupAvailable = useCallback(() => {
    if (localNodeKey == null) {
      setBackupAvailable(false);
      return;
    }
    setBackupAvailable(
      protocol === 'meshtastic'
        ? hasMeshtasticDmKeyBackup(localNodeKey)
        : hasMeshcoreKeyBackup(localNodeKey),
    );
  }, [localNodeKey, protocol]);

  const bumpIndex = useCallback(() => {
    setIndexRevision((n) => n + 1);
  }, []);

  const refreshStatus = useCallback(() => {
    refreshBackupAvailable();
    bumpIndex();
  }, [refreshBackupAvailable, bumpIndex]);

  useEffect(() => {
    if (safeStorageAvailable !== true || localNodeKey == null) {
      refreshBackupAvailable();
      return;
    }
    void (async () => {
      if (protocol === 'meshtastic') {
        await migrateLegacyMeshtasticDmKeyBackup(localNodeKey);
      }
      refreshStatus();
    })();
  }, [safeStorageAvailable, localNodeKey, protocol, refreshBackupAvailable, refreshStatus]);

  const allBackups = useMemo((): BackupIndexEntry[] => {
    void indexRevision;
    return protocol === 'meshtastic' ? listMeshtasticDmKeyBackups() : listMeshcoreKeyBackups();
  }, [protocol, indexRevision]);

  const otherBackupCount = useMemo(() => {
    if (localNodeKey == null) return allBackups.length;
    return allBackups.filter((e) => entryNodeKey(e, protocol) !== localNodeKey >>> 0).length;
  }, [allBackups, localNodeKey, protocol]);

  const runRestore = useCallback(
    async (nodeKey: number) => {
      setBackupInProgress(true);
      try {
        const loaded =
          protocol === 'meshtastic'
            ? await loadMeshtasticDmKeyBackup(nodeKey)
            : await loadMeshcoreKeyBackup(nodeKey);
        if (!loaded) throw new Error('No backup found');
        const ok =
          protocol === 'meshtastic'
            ? await onMeshtasticRestore(loaded.publicKey, loaded.privateKey)
            : await onMeshcoreRestore(loaded.publicKey, loaded.privateKey);
        if (ok) {
          addToast(t('securityPanel.restoreVerifySuccess'), 'success');
          refreshStatus();
        } else {
          addToast(t('securityPanel.restoreVerifyFailed'), 'error');
        }
      } catch (err) {
        console.warn('[KeyBackupRestoreSection] restore ' + errLikeToLogString(err));
        addToast(
          t('securityPanel.restoreFailed', {
            message: err instanceof Error ? err.message : 'Unknown error',
          }),
          'error',
        );
      } finally {
        setBackupInProgress(false);
        setShowPicker(false);
        setPendingRestoreKey(null);
      }
    },
    [protocol, onMeshtasticRestore, onMeshcoreRestore, addToast, t, refreshStatus],
  );

  const handleBackup = useCallback(async () => {
    if (localNodeKey == null || !canBackup) return;
    setBackupInProgress(true);
    try {
      const keys =
        protocol === 'meshtastic' ? await onMeshtasticBackup() : await onMeshcoreBackup();
      if (!keys) throw new Error('Missing key material');
      if (protocol === 'meshtastic') {
        await saveMeshtasticDmKeyBackup({
          nodeNum: localNodeKey,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          nodeLabel: localNodeLabel,
        });
      } else {
        await saveMeshcoreKeyBackup({
          nodeId: localNodeKey,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          nodeLabel: localNodeLabel,
        });
      }
      addToast(t('securityPanel.keysBackedUpForDevice', { label: nodeDisplayLabel }), 'success');
      refreshStatus();
    } catch (err) {
      console.warn('[KeyBackupRestoreSection] backup ' + errLikeToLogString(err));
      addToast(
        t('securityPanel.backupFailed', {
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        'error',
      );
    } finally {
      setBackupInProgress(false);
    }
  }, [
    localNodeKey,
    canBackup,
    protocol,
    onMeshtasticBackup,
    onMeshcoreBackup,
    localNodeLabel,
    nodeDisplayLabel,
    addToast,
    t,
    refreshStatus,
  ]);

  const handleRemove = useCallback(
    (nodeKey: number) => {
      if (protocol === 'meshtastic') {
        deleteMeshtasticDmKeyBackup(nodeKey);
      } else {
        deleteMeshcoreKeyBackup(nodeKey);
      }
      addToast(t('securityPanel.backupRemoved'), 'success');
      setRemoveConfirmKey(null);
      refreshStatus();
    },
    [protocol, addToast, t, refreshStatus],
  );

  if (safeStorageAvailable === false) {
    return <p className="text-xs text-yellow-400">{t('securityPanel.keyBackupUnavailable')}</p>;
  }

  if (safeStorageAvailable === null) {
    return null;
  }

  const pendingEntry =
    pendingRestoreKey != null
      ? allBackups.find((e) => entryNodeKey(e, protocol) === pendingRestoreKey)
      : null;

  return (
    <>
      <p className="text-muted text-xs">{t('securityPanel.keyBackupDesc')}</p>
      <p className="text-muted text-xs">{t('securityPanel.keyBackupNotIncluded')}</p>
      <div className="text-muted flex items-center gap-2 text-xs">
        <span
          className={`h-2 w-2 rounded-full ${backupAvailable ? 'bg-readable-green' : 'bg-gray-600'}`}
        />
        {backupAvailable
          ? t('securityPanel.backupAvailableForNode', { label: nodeDisplayLabel })
          : t('securityPanel.noBackupForNode', { label: nodeDisplayLabel })}
      </div>
      {otherBackupCount > 0 && (
        <p className="text-muted text-xs">
          {t('securityPanel.otherBackupsCount', { count: otherBackupCount })}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            void handleBackup();
          }}
          disabled={disabled || backupInProgress || !canBackup || localNodeKey == null}
          className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
        >
          {backupInProgress ? t('securityPanel.working') : t('securityPanel.backupKeys')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (localNodeKey != null && backupAvailable) {
              setPendingRestoreKey(localNodeKey);
            }
          }}
          disabled={disabled || backupInProgress || !backupAvailable || localNodeKey == null}
          className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
        >
          {backupInProgress ? t('securityPanel.working') : t('securityPanel.restoreKeys')}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowPicker(true);
          }}
          disabled={disabled || backupInProgress || allBackups.length === 0}
          className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
        >
          {t('securityPanel.restoreFromBackup')}
        </button>
        {backupAvailable && localNodeKey != null && (
          <button
            type="button"
            onClick={() => {
              setRemoveConfirmKey(localNodeKey);
            }}
            disabled={disabled || backupInProgress}
            className="bg-secondary-dark rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
          >
            {t('securityPanel.removeBackup')}
          </button>
        )}
      </div>

      {showPicker && (
        <div className="space-y-2 rounded-lg border border-gray-700 bg-gray-900/40 p-3">
          <p className="text-sm font-medium text-gray-200">
            {t('securityPanel.restoreFromBackupTitle')}
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {allBackups.map((entry) => {
              const nodeKey = entryNodeKey(entry, protocol);
              const prefix = publicKeyPrefixHex(
                Uint8Array.from(atob(entry.publicKeyB64), (c) => c.charCodeAt(0)),
              );
              return (
                <li key={nodeKey}>
                  <button
                    type="button"
                    disabled={disabled || backupInProgress}
                    onClick={() => {
                      setPendingRestoreKey(nodeKey);
                    }}
                    className="hover:bg-secondary-dark w-full rounded px-2 py-1.5 text-left text-xs text-gray-300"
                  >
                    {formatEntryLabel(entry, protocol, t)} · {prefix}… ·{' '}
                    {new Date(entry.backedUpAt).toLocaleString()}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              setShowPicker(false);
            }}
            className="text-muted text-xs hover:text-gray-200"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}

      {pendingRestoreKey != null && pendingEntry && (
        <ConfirmModal
          title={t('securityPanel.restoreFromBackupTitle')}
          message={t('securityPanel.restoreFromBackupConfirm', {
            label: formatEntryLabel(pendingEntry, protocol, t),
          })}
          confirmLabel={t('securityPanel.restoreKeys')}
          onConfirm={() => {
            void runRestore(pendingRestoreKey);
          }}
          onCancel={() => {
            setPendingRestoreKey(null);
          }}
        />
      )}

      {removeConfirmKey != null && (
        <ConfirmModal
          title={t('securityPanel.removeBackup')}
          message={t('securityPanel.removeBackupConfirm')}
          confirmLabel={t('securityPanel.removeBackup')}
          danger
          onConfirm={() => {
            handleRemove(removeConfirmKey);
          }}
          onCancel={() => {
            setRemoveConfirmKey(null);
          }}
        />
      )}
    </>
  );
}
