import { useTranslation } from 'react-i18next';

import {
  meshcoreWaitingMessagesClickableSync,
  type MeshcoreWaitingMessagesStatusInput,
  meshcoreWaitingMessagesStatusText,
  meshcoreWaitingMessagesSyncBusy,
  meshcoreWaitingMessagesVisible,
} from '@/renderer/lib/meshcoreWaitingMessagesStatusText';

import { HelpTooltip } from './HelpTooltip';

export interface MeshcoreWaitingMessagesHeaderIndicatorProps extends MeshcoreWaitingMessagesStatusInput {
  onSync?: () => void;
}

function WaitingMessagesSpinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"
      aria-hidden
    />
  );
}

function WaitingMessagesDeferredIcon() {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-400"
      aria-hidden
    />
  );
}

function WaitingMessagesQueuedPill({ count }: { count: number }) {
  return (
    <span
      className="flex shrink-0 items-center rounded border border-amber-700 bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-200"
      aria-hidden
    >
      {count}
    </span>
  );
}

export function MeshcoreWaitingMessagesHeaderIndicator({
  waitingMessagesCount,
  waitingMessagesSyncActive,
  waitingMessagesSyncProgress,
  waitingMessagesSilentDrainActive,
  waitingMessagesDrainDeferred,
  connectionType,
  onSync,
}: MeshcoreWaitingMessagesHeaderIndicatorProps) {
  const { t } = useTranslation();

  const input: MeshcoreWaitingMessagesStatusInput = {
    waitingMessagesCount,
    waitingMessagesSyncActive,
    waitingMessagesSyncProgress,
    waitingMessagesSilentDrainActive,
    waitingMessagesDrainDeferred,
    connectionType,
  };

  if (!meshcoreWaitingMessagesVisible(input)) return null;

  const statusText = meshcoreWaitingMessagesStatusText(t, input);
  if (!statusText) return null;

  const syncBusy = meshcoreWaitingMessagesSyncBusy(input);
  const clickable = meshcoreWaitingMessagesClickableSync(input) && onSync != null;

  const indicator = syncBusy ? (
    <WaitingMessagesSpinner />
  ) : waitingMessagesDrainDeferred ? (
    <WaitingMessagesDeferredIcon />
  ) : (
    <WaitingMessagesQueuedPill count={waitingMessagesCount} />
  );

  if (clickable) {
    return (
      <HelpTooltip text={statusText} className="shrink-0" nonFocusableWrapper>
        <button
          type="button"
          onClick={onSync}
          className="m-0 inline-flex cursor-pointer appearance-none items-center border-0 bg-transparent p-0"
          aria-label={statusText}
        >
          {indicator}
        </button>
      </HelpTooltip>
    );
  }

  return (
    <HelpTooltip text={statusText} className="shrink-0">
      <span
        role="status"
        aria-live="polite"
        aria-busy={syncBusy || undefined}
        aria-label={statusText}
        className="inline-flex items-center"
      >
        {indicator}
      </span>
    </HelpTooltip>
  );
}
