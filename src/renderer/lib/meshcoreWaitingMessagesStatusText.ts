import type { TFunction } from 'i18next';

export interface MeshcoreWaitingMessagesStatusInput {
  waitingMessagesCount: number;
  waitingMessagesSyncActive: boolean;
  waitingMessagesSyncProgress: { processed: number; total: number } | null;
  waitingMessagesSilentDrainActive: boolean;
  waitingMessagesDrainDeferred: boolean;
  connectionType?: 'serial' | 'ble' | 'tcp' | 'http' | null;
}

function appendSerialHint(
  t: TFunction,
  text: string,
  connectionType: MeshcoreWaitingMessagesStatusInput['connectionType'],
  showSerialHint: boolean,
): string {
  if (!showSerialHint || connectionType !== 'serial') return text;
  return `${text} ${t('chatPanel.waitingMessagesSerialHint')}`;
}

export function meshcoreWaitingMessagesStatusText(
  t: TFunction,
  input: MeshcoreWaitingMessagesStatusInput,
): string | null {
  const {
    waitingMessagesCount,
    waitingMessagesSyncActive,
    waitingMessagesSyncProgress,
    waitingMessagesSilentDrainActive,
    waitingMessagesDrainDeferred,
    connectionType,
  } = input;

  const visible =
    waitingMessagesCount > 0 ||
    waitingMessagesSyncActive ||
    waitingMessagesSilentDrainActive ||
    waitingMessagesDrainDeferred;

  if (!visible) return null;

  const syncBusy = waitingMessagesSyncActive || waitingMessagesSilentDrainActive;

  if (syncBusy) {
    if (waitingMessagesSyncProgress && waitingMessagesSyncProgress.total > 0) {
      return appendSerialHint(
        t,
        t('chatPanel.waitingMessagesSyncProgress', {
          processed: waitingMessagesSyncProgress.processed,
          total: waitingMessagesSyncProgress.total,
        }),
        connectionType,
        waitingMessagesSilentDrainActive && !waitingMessagesSyncActive,
      );
    }
    if (
      waitingMessagesSilentDrainActive &&
      !waitingMessagesSyncActive &&
      waitingMessagesSyncProgress?.total === 0
    ) {
      return appendSerialHint(
        t,
        t('chatPanel.waitingMessagesSilentFetched', {
          processed: waitingMessagesSyncProgress.processed,
        }),
        connectionType,
        true,
      );
    }
    const primary = waitingMessagesSyncActive
      ? t('chatPanel.waitingMessagesSyncProgressIndeterminate')
      : t('chatPanel.waitingMessagesSilentDrain');
    return appendSerialHint(
      t,
      primary,
      connectionType,
      waitingMessagesSilentDrainActive && !waitingMessagesSyncActive,
    );
  }

  if (waitingMessagesDrainDeferred) {
    return appendSerialHint(t, t('chatPanel.waitingMessagesDrainDeferred'), connectionType, true);
  }

  const queued = t('chatPanel.waitingMessagesQueued', { count: waitingMessagesCount });
  return `${queued} ${t('chatPanel.waitingMessagesSyncNow')}`;
}

export function meshcoreWaitingMessagesVisible(input: MeshcoreWaitingMessagesStatusInput): boolean {
  return (
    input.waitingMessagesCount > 0 ||
    input.waitingMessagesSyncActive ||
    input.waitingMessagesSilentDrainActive ||
    input.waitingMessagesDrainDeferred
  );
}

export function meshcoreWaitingMessagesVisibleForProtocol(
  input: MeshcoreWaitingMessagesStatusInput,
  activeProtocol: 'meshtastic' | 'meshcore' | 'reticulum',
): boolean {
  if (!meshcoreWaitingMessagesVisible(input)) return false;
  if (activeProtocol !== 'meshcore') {
    if (meshcoreWaitingMessagesSyncBusy(input)) {
      return false;
    }
    if (input.waitingMessagesDrainDeferred) {
      return false;
    }
  }
  return true;
}

export function meshcoreWaitingMessagesSyncBusy(
  input: MeshcoreWaitingMessagesStatusInput,
): boolean {
  return input.waitingMessagesSyncActive || input.waitingMessagesSilentDrainActive;
}

export function meshcoreWaitingMessagesClickableSync(
  input: MeshcoreWaitingMessagesStatusInput,
): boolean {
  return (
    input.waitingMessagesCount > 0 &&
    !meshcoreWaitingMessagesSyncBusy(input) &&
    !input.waitingMessagesDrainDeferred
  );
}
