import { useTranslation } from 'react-i18next';

export interface MeshcoreWaitingMessagesBannerProps {
  waitingMessagesCount: number;
  waitingMessagesSyncActive: boolean;
  waitingMessagesSyncProgress: { processed: number; total: number } | null;
  waitingMessagesSilentDrainActive: boolean;
  waitingMessagesDrainDeferred: boolean;
  connectionType?: 'serial' | 'ble' | 'tcp' | 'http' | null;
  onSyncWaitingMessages?: () => void;
  className?: string;
}

export function MeshcoreWaitingMessagesBanner({
  waitingMessagesCount,
  waitingMessagesSyncActive,
  waitingMessagesSyncProgress,
  waitingMessagesSilentDrainActive,
  waitingMessagesDrainDeferred,
  connectionType,
  onSyncWaitingMessages,
  className = '',
}: MeshcoreWaitingMessagesBannerProps) {
  const { t } = useTranslation();

  const visible =
    waitingMessagesCount > 0 ||
    waitingMessagesSyncActive ||
    waitingMessagesSilentDrainActive ||
    waitingMessagesDrainDeferred;

  if (!visible) return null;

  const syncBusy = waitingMessagesSyncActive || waitingMessagesSilentDrainActive;

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-1.5 text-xs text-amber-200 ${className}`.trim()}
      role="status"
      aria-busy={syncBusy || undefined}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {syncBusy ? (
            <>
              <span
                className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"
                aria-hidden
              />
              {waitingMessagesSyncActive
                ? waitingMessagesSyncProgress && waitingMessagesSyncProgress.total > 0
                  ? t('chatPanel.waitingMessagesSyncProgress', {
                      processed: waitingMessagesSyncProgress.processed,
                      total: waitingMessagesSyncProgress.total,
                    })
                  : t('chatPanel.waitingMessagesSyncProgressIndeterminate')
                : t('chatPanel.waitingMessagesSilentDrain')}
            </>
          ) : waitingMessagesDrainDeferred ? (
            t('chatPanel.waitingMessagesDrainDeferred')
          ) : (
            t('chatPanel.waitingMessagesQueued', { count: waitingMessagesCount })
          )}
        </span>
        {(waitingMessagesSilentDrainActive || waitingMessagesDrainDeferred) &&
          connectionType === 'serial' && (
            <span className="text-muted text-[10px]">
              {t('chatPanel.waitingMessagesSerialHint')}
            </span>
          )}
      </span>
      {onSyncWaitingMessages && (
        <button
          type="button"
          onClick={onSyncWaitingMessages}
          disabled={syncBusy}
          className="rounded border border-amber-600/60 px-2 py-0.5 text-[10px] font-medium hover:bg-amber-800/40 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t('chatPanel.waitingMessagesSyncNow')}
          aria-busy={waitingMessagesSyncActive || undefined}
        >
          {t('chatPanel.waitingMessagesSyncNow')}
        </button>
      )}
    </div>
  );
}
