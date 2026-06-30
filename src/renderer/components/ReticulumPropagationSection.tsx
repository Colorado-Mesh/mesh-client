import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

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
  const sync = useReticulumPropagationStore((s) => s.sync);
  const refreshFromSidecar = useReticulumPropagationStore((s) => s.refreshFromSidecar);
  const setPreferredOnSidecar = useReticulumPropagationStore((s) => s.setPreferredOnSidecar);
  const startSync = useReticulumPropagationStore((s) => s.startSync);
  const cancelSync = useReticulumPropagationStore((s) => s.cancelSync);

  useEffect(() => {
    void refreshFromSidecar();
  }, [refreshFromSidecar]);

  const handleRefresh = () => {
    void refreshFromSidecar().then(() => onRefresh?.());
  };

  const body = (
    <>
      {!embedded ? (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-200">
            {t('connectionPanel.reticulumPropagation.title')}
          </h3>
          <button
            type="button"
            className="text-xs text-amber-400 hover:underline"
            onClick={handleRefresh}
          >
            {t('common.refresh')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="text-xs text-amber-400 hover:underline"
          onClick={handleRefresh}
        >
          {t('common.refresh')}
        </button>
      )}
      {sync.active ? (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded bg-gray-800">
            <div
              className="bg-readable-green h-full transition-all"
              style={{ width: `${Math.min(100, sync.progress)}%` }}
            />
          </div>
          <button
            type="button"
            className="mt-2 text-xs text-red-400 hover:underline"
            onClick={() => {
              void cancelSync();
            }}
          >
            {t('reticulumPropagation.cancelSync')}
          </button>
        </div>
      ) : null}
      <ul className="mt-2 space-y-2 text-sm">
        {nodes.map((node) => (
          <li
            key={node.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-700/60 px-2 py-1.5"
          >
            <span>
              {node.name} ({node.status})
              {preferredId === node.id ? (
                <span className="text-readable-green ml-1 text-xs">
                  {t('reticulumPropagation.preferred')}
                </span>
              ) : null}
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
                className="text-xs text-amber-400 hover:underline"
                onClick={() =>
                  void window.electronAPI.reticulum
                    .proxyPost(
                      `/api/v1/propagation/${node.id}/${node.enabled ? 'disable' : 'enable'}`,
                      {},
                    )
                    .then(handleRefresh)
                }
              >
                {node.enabled
                  ? t('connectionPanel.reticulumPropagation.disable')
                  : t('connectionPanel.reticulumPropagation.enable')}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!preferredId || sync.active}
          className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-300 disabled:opacity-40"
          onClick={() => {
            void startSync();
          }}
        >
          {t('reticulumPropagation.syncNow')}
        </button>
        {autoSyncIntervalSec > 0 ? (
          <span className="text-muted text-xs">
            {t('reticulumPropagation.autoSyncInterval', { sec: autoSyncIntervalSec })}
          </span>
        ) : null}
      </div>
    </>
  );

  if (embedded) return body;

  return <div className="bg-deep-black rounded-lg border border-gray-700 p-4">{body}</div>;
}
