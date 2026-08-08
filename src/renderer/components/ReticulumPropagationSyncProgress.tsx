import { RefreshCw } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { formatRelativeOrIsoDate } from '@/renderer/lib/formatRelativeOrIsoDate';
import { resolveReticulumPropagationTargetLabel } from '@/renderer/lib/reticulum/reticulumPropagationMode';
import {
  isPropagationSyncSupersedeMessage,
  propagationSyncStatusLabel,
} from '@/renderer/lib/reticulum/reticulumPropagationSync';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

/**
 * Name of the node the current (or most recent) sync attempt targeted, or `null` when no
 * node was contacted — the cascade clears the target so "nothing to sync with" errors are
 * never blamed on a node.
 */
export function getReticulumPropagationSyncTargetName(localLabel: string): string | null {
  const { nodes, discovered, syncTargetId } = useReticulumPropagationStore.getState();
  if (syncTargetId == null || syncTargetId.length === 0) return null;
  return resolveReticulumPropagationTargetLabel(nodes, discovered, syncTargetId, localLabel);
}

export function useReticulumPropagationSyncTargetName(): string | null {
  const { t } = useTranslation();
  const nodes = useReticulumPropagationStore((s) => s.nodes);
  const discovered = useReticulumPropagationStore((s) => s.discovered);
  const syncTargetId = useReticulumPropagationStore((s) => s.syncTargetId);
  if (syncTargetId == null || syncTargetId.length === 0) return null;
  return resolveReticulumPropagationTargetLabel(
    nodes,
    discovered,
    syncTargetId,
    t('reticulumPropagation.localHostName'),
  );
}

export function ReticulumPropagationSyncProgress({
  cancelLabel,
  cancelAriaLabel,
  disabled = false,
}: {
  cancelLabel: string;
  cancelAriaLabel: string;
  disabled?: boolean;
}) {
  const sync = useReticulumPropagationStore((s) => s.sync);
  const lastSyncError = useReticulumPropagationStore((s) => s.lastSyncError);
  const cancelSync = useReticulumPropagationStore((s) => s.cancelSync);
  const targetName = useReticulumPropagationSyncTargetName();
  const { t } = useTranslation();

  const status = t(propagationSyncStatusLabel(sync.progress));

  return (
    <>
      {sync.active ? (
        <div className="mt-2 space-y-1" role="status" aria-live="polite">
          <p className="text-xs text-amber-300">
            {targetName
              ? t('reticulumPropagation.syncStatusWithTarget', { status, name: targetName })
              : status}
          </p>
          <div className="h-2 overflow-hidden rounded bg-gray-800">
            <div
              className="bg-readable-green h-full transition-all"
              style={{ width: `${Math.min(100, sync.progress)}%` }}
            />
          </div>
          <button
            type="button"
            disabled={disabled}
            className="text-xs text-red-400 hover:underline disabled:opacity-40"
            aria-label={cancelAriaLabel}
            onClick={() => {
              void cancelSync();
            }}
          >
            {cancelLabel}
          </button>
        </div>
      ) : null}
      {!sync.active && lastSyncError && !isPropagationSyncSupersedeMessage(lastSyncError) ? (
        <p className="mt-2 text-xs text-red-400" role="alert">
          {targetName
            ? t('reticulumPropagation.syncErrorWithTarget', {
                name: targetName,
                message: t(lastSyncError),
              })
            : t(lastSyncError)}
        </p>
      ) : null}
    </>
  );
}

export function ReticulumPropagationRefreshButton({
  refreshing,
  onRefresh,
  className = 'inline-flex items-center gap-1 text-xs text-amber-400 hover:underline disabled:opacity-40',
}: {
  refreshing: boolean;
  onRefresh: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={className}
      disabled={refreshing}
      aria-label={t('reticulumPropagation.refreshAria')}
      aria-busy={refreshing}
      onClick={onRefresh}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
      {refreshing ? t('reticulumPropagation.refreshing') : t('common.refresh')}
    </button>
  );
}

export function ReticulumPropagationLastRefreshed() {
  const { t } = useTranslation();
  const lastRefreshedAt = useReticulumPropagationStore((s) => s.lastRefreshedAt);

  if (!lastRefreshedAt) return null;

  return (
    <p className="text-muted text-xs" aria-live="polite">
      {t('reticulumPropagation.lastRefreshed', {
        time: formatRelativeOrIsoDate(lastRefreshedAt, t),
      })}
    </p>
  );
}
