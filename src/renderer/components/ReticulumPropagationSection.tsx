import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatRelativeOrIsoDate } from '@/renderer/lib/formatRelativeOrIsoDate';
import { RETICULUM_PROPAGATION_REFRESH_MIN_VISIBLE_MS } from '@/renderer/lib/reticulum/reticulumPropagationSync';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';
import {
  RETICULUM_PROPAGATION_AUTO_SYNC_INTERVALS_SEC,
  reticulumPropagationAutoSyncOptionKey,
} from '@/shared/reticulumPropagationAutoSync';

import { ConfirmModal } from './ConfirmModal';
import {
  ReticulumPropagationLastRefreshed,
  ReticulumPropagationRefreshButton,
  ReticulumPropagationSyncProgress,
} from './ReticulumPropagationSyncProgress';

const PROPAGATION_NODE_STATUS_KEYS = new Set([
  'active',
  'idle',
  'known',
  'pending',
  'unknown',
  'online',
]);

function formatPropagationNodeStatus(status: string, t: (key: string) => string): string {
  if (PROPAGATION_NODE_STATUS_KEYS.has(status)) {
    return t(`reticulumPropagation.nodeStatus.${status}`);
  }
  return status;
}
export interface ReticulumPropagationSectionProps {
  onRefresh?: () => void;
  embedded?: boolean;
}

export default function ReticulumPropagationSection({
  onRefresh,
  embedded = false,
}: ReticulumPropagationSectionProps) {
  const { t } = useTranslation();
  const nodes = useReticulumPropagationStore((s) => s.nodes);
  const preferredId = useReticulumPropagationStore((s) => s.preferredId);
  const autoSyncIntervalSec = useReticulumPropagationStore((s) => s.autoSyncIntervalSec);
  const lastPropagationSyncAt = useReticulumPropagationStore((s) => s.lastPropagationSyncAt);
  const sync = useReticulumPropagationStore((s) => s.sync);
  const refreshFromSidecar = useReticulumPropagationStore((s) => s.refreshFromSidecar);
  const setPreferredOnSidecar = useReticulumPropagationStore((s) => s.setPreferredOnSidecar);
  const setAutoSyncIntervalOnSidecar = useReticulumPropagationStore(
    (s) => s.setAutoSyncIntervalOnSidecar,
  );
  const startSync = useReticulumPropagationStore((s) => s.startSync);
  const addPropagationNode = useReticulumPropagationStore((s) => s.addPropagationNode);
  const removePropagationNode = useReticulumPropagationStore((s) => s.removePropagationNode);
  const renamePropagationNode = useReticulumPropagationStore((s) => s.renamePropagationNode);
  const [addHash, setAddHash] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    void refreshFromSidecar();
  }, [refreshFromSidecar]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const startedAt = Date.now();
    try {
      await refreshFromSidecar();
      onRefresh?.();
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = RETICULUM_PROPAGATION_REFRESH_MIN_VISIBLE_MS - elapsed;
      if (remaining > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, remaining);
        });
      }
      setRefreshing(false);
    }
  };

  const body = (
    <>
      {!embedded ? (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-200">
            {t('connectionPanel.reticulumPropagation.title')}
          </h3>
          <ReticulumPropagationRefreshButton
            refreshing={refreshing}
            onRefresh={() => {
              void handleRefresh();
            }}
          />
        </div>
      ) : (
        <ReticulumPropagationRefreshButton
          refreshing={refreshing}
          onRefresh={() => {
            void handleRefresh();
          }}
        />
      )}
      <ReticulumPropagationLastRefreshed />
      <ReticulumPropagationSyncProgress
        cancelLabel={t('reticulumPropagation.cancelSync')}
        cancelAriaLabel={t('reticulumPropagation.cancelSync')}
      />
      <ul
        className={`mt-2 space-y-2 text-sm transition-opacity ${refreshing ? 'opacity-60' : 'opacity-100'}`}
        aria-busy={refreshing}
      >
        {nodes.map((node) => {
          const isLocal = node.id === 'local-prop';
          const isRenaming = renamingId === node.id;
          return (
            <li
              key={node.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-700/60 px-2 py-1.5"
            >
              <span className="min-w-0 flex-1">
                {isRenaming ? (
                  <label className="flex flex-wrap items-center gap-2">
                    <span className="sr-only">{t('reticulumPropagation.renameLabel')}</span>
                    <input
                      type="text"
                      value={renameDraft}
                      onChange={(e) => {
                        setRenameDraft(e.target.value);
                      }}
                      className="min-w-[10rem] flex-1 rounded border border-gray-700 bg-slate-900 px-2 py-1 text-sm text-gray-200"
                      aria-label={t('reticulumPropagation.renameLabel')}
                    />
                    <button
                      type="button"
                      className="text-xs text-amber-400 hover:underline disabled:opacity-40"
                      disabled={!renameDraft.trim()}
                      aria-label={t('reticulumPropagation.renameSaveAria')}
                      onClick={() => {
                        void renamePropagationNode(node.id, renameDraft.trim()).then((ok) => {
                          if (ok) {
                            setRenamingId(null);
                            setRenameDraft('');
                          }
                        });
                      }}
                    >
                      {t('reticulumPropagation.renameSave')}
                    </button>
                    <button
                      type="button"
                      className="text-muted text-xs hover:underline"
                      aria-label={t('reticulumPropagation.renameCancelAria')}
                      onClick={() => {
                        setRenamingId(null);
                        setRenameDraft('');
                      }}
                    >
                      {t('common.cancel')}
                    </button>
                  </label>
                ) : (
                  <>
                    {node.name} ({formatPropagationNodeStatus(node.status, t)})
                    {isLocal && node.message_count != null ? (
                      <span className="text-muted ml-1 text-xs">
                        {t('reticulumPropagation.localInboxStats', {
                          count: node.message_count,
                          bytes: node.storage_bytes ?? 0,
                        })}
                      </span>
                    ) : null}
                    {preferredId === node.id ? (
                      <span className="text-readable-green ml-1 text-xs">
                        {t('reticulumPropagation.preferred')}
                      </span>
                    ) : null}
                  </>
                )}
              </span>
              <span className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="text-xs text-amber-400 hover:underline"
                  onClick={() => {
                    void setPreferredOnSidecar(node.id);
                  }}
                  aria-label={t('reticulumPropagation.setPreferred')}
                >
                  {t('reticulumPropagation.setPreferred')}
                </button>
                <button
                  type="button"
                  className="text-xs text-amber-400 hover:underline disabled:opacity-40"
                  disabled={sync.active}
                  onClick={() => {
                    void startSync(node.id);
                  }}
                  aria-label={t('reticulumPropagation.syncNowFor', { name: node.name })}
                >
                  {t('reticulumPropagation.syncNow')}
                </button>
                <button
                  type="button"
                  className="text-xs text-amber-400 hover:underline"
                  onClick={() =>
                    void window.electronAPI.reticulum
                      .proxyPost(
                        `/api/v1/propagation/${node.id}/${node.enabled ? 'disable' : 'enable'}`,
                        {},
                      )
                      .then(handleRefresh)
                  }
                  aria-label={
                    node.enabled
                      ? t('reticulumPropagation.disableAria', { name: node.name })
                      : t('reticulumPropagation.enableAria', { name: node.name })
                  }
                >
                  {node.enabled
                    ? t('connectionPanel.reticulumPropagation.disable')
                    : t('connectionPanel.reticulumPropagation.enable')}
                </button>
                {!isLocal && !isRenaming ? (
                  <>
                    <button
                      type="button"
                      className="text-xs text-amber-400 hover:underline"
                      onClick={() => {
                        setRenamingId(node.id);
                        setRenameDraft(node.name);
                      }}
                      aria-label={t('reticulumPropagation.renameAria', { name: node.name })}
                    >
                      {t('reticulumPropagation.rename')}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:underline"
                      onClick={() => {
                        setPendingDelete({ id: node.id, name: node.name });
                      }}
                      aria-label={t('reticulumPropagation.deleteAria', { name: node.name })}
                    >
                      {t('reticulumPropagation.delete')}
                    </button>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 space-y-1">
        <label htmlFor="reticulum-propagation-auto-sync" className="text-muted text-xs">
          {t('reticulumPropagation.autoSyncIntervalLabel')}
        </label>
        <select
          id="reticulum-propagation-auto-sync"
          value={autoSyncIntervalSec}
          disabled={sync.active}
          onChange={(e) => {
            const sec = Number(e.target.value);
            void setAutoSyncIntervalOnSidecar(sec);
          }}
          className="bg-deep-black focus:border-brand-green w-full max-w-md rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none disabled:opacity-40"
          aria-label={t('reticulumPropagation.autoSyncIntervalAria')}
        >
          {RETICULUM_PROPAGATION_AUTO_SYNC_INTERVALS_SEC.map((sec) => (
            <option key={sec} value={sec}>
              {t(reticulumPropagationAutoSyncOptionKey(sec))}
            </option>
          ))}
        </select>
        {lastPropagationSyncAt ? (
          <p className="text-muted text-xs">
            {t('reticulumPropagation.lastSynced', {
              time: formatRelativeOrIsoDate(lastPropagationSyncAt, t),
            })}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!preferredId || sync.active}
          className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-300 disabled:opacity-40"
          aria-label={t('reticulumPropagation.syncNowPreferredAria')}
          onClick={() => {
            void startSync();
          }}
        >
          {t('reticulumPropagation.syncNow')}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
          <span className="text-muted">{t('reticulumPropagation.addNodeLabel')}</span>
          <input
            type="text"
            value={addHash}
            onChange={(e) => {
              setAddHash(e.target.value);
            }}
            placeholder={t('reticulumPropagation.addNodePlaceholder')}
            className="rounded border border-gray-700 bg-slate-900 px-2 py-1 text-sm text-gray-200"
            aria-label={t('reticulumPropagation.addNodeLabel')}
          />
        </label>
        <button
          type="button"
          disabled={!addHash.trim()}
          className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-300 disabled:opacity-40"
          onClick={() => {
            void addPropagationNode(addHash.trim()).then((ok) => {
              if (ok) {
                setAddHash('');
                void handleRefresh();
              }
            });
          }}
        >
          {t('reticulumPropagation.addNode')}
        </button>
      </div>
      {pendingDelete ? (
        <ConfirmModal
          title={t('reticulumPropagation.deleteConfirmTitle')}
          message={t('reticulumPropagation.deleteConfirmBody', { name: pendingDelete.name })}
          confirmLabel={t('reticulumPropagation.deleteConfirm')}
          danger
          onConfirm={() => {
            const id = pendingDelete.id;
            setPendingDelete(null);
            void removePropagationNode(id);
          }}
          onCancel={() => {
            setPendingDelete(null);
          }}
        />
      ) : null}
    </>
  );

  if (embedded) return body;

  return <div className="bg-deep-black rounded-lg border border-gray-700 p-4">{body}</div>;
}
