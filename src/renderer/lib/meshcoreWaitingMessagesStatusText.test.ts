import { describe, expect, it } from 'vitest';

import {
  meshcoreWaitingMessagesClickableSync,
  type MeshcoreWaitingMessagesStatusInput,
  meshcoreWaitingMessagesStatusText,
  meshcoreWaitingMessagesSyncBusy,
  meshcoreWaitingMessagesVisible,
  meshcoreWaitingMessagesVisibleForProtocol,
} from './meshcoreWaitingMessagesStatusText';

const baseInput: MeshcoreWaitingMessagesStatusInput = {
  waitingMessagesCount: 0,
  waitingMessagesSyncActive: false,
  waitingMessagesSyncProgress: null,
  waitingMessagesSilentDrainActive: false,
  waitingMessagesDrainDeferred: false,
  connectionType: null,
};

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (key === 'chatPanel.waitingMessagesSyncProgress') {
    return `Sync ${opts?.processed}/${opts?.total}`;
  }
  if (key === 'chatPanel.waitingMessagesQueued') {
    return `${opts?.count} queued`;
  }
  const labels: Record<string, string> = {
    'chatPanel.waitingMessagesSyncProgressIndeterminate': 'Syncing…',
    'chatPanel.waitingMessagesSilentDrain': 'Silent drain',
    'chatPanel.waitingMessagesDrainDeferred': 'Drain deferred',
    'chatPanel.waitingMessagesSyncNow': 'Sync now',
    'chatPanel.waitingMessagesSerialHint': '(serial hint)',
  };
  return labels[key] ?? key;
}) as Parameters<typeof meshcoreWaitingMessagesStatusText>[0];

describe('meshcoreWaitingMessagesStatusText', () => {
  it('returns null when nothing is visible', () => {
    expect(meshcoreWaitingMessagesVisible(baseInput)).toBe(false);
    expect(meshcoreWaitingMessagesStatusText(t, baseInput)).toBeNull();
  });

  it('reports indeterminate sync progress', () => {
    const input: MeshcoreWaitingMessagesStatusInput = {
      ...baseInput,
      waitingMessagesSyncActive: true,
    };
    expect(meshcoreWaitingMessagesSyncBusy(input)).toBe(true);
    expect(meshcoreWaitingMessagesStatusText(t, input)).toBe('Syncing…');
  });

  it('reports numeric sync progress', () => {
    const input: MeshcoreWaitingMessagesStatusInput = {
      ...baseInput,
      waitingMessagesSyncActive: true,
      waitingMessagesSyncProgress: { processed: 2, total: 5 },
    };
    expect(meshcoreWaitingMessagesStatusText(t, input)).toBe('Sync 2/5');
  });

  it('appends serial hint during silent drain on serial transport', () => {
    const input: MeshcoreWaitingMessagesStatusInput = {
      ...baseInput,
      waitingMessagesSilentDrainActive: true,
      connectionType: 'serial',
    };
    expect(meshcoreWaitingMessagesStatusText(t, input)).toBe('Silent drain (serial hint)');
  });

  it('does not append serial hint during manual sync', () => {
    const input: MeshcoreWaitingMessagesStatusInput = {
      ...baseInput,
      waitingMessagesSyncActive: true,
      waitingMessagesSilentDrainActive: true,
      connectionType: 'serial',
    };
    expect(meshcoreWaitingMessagesStatusText(t, input)).toBe('Syncing…');
  });

  it('reports deferred drain with serial hint', () => {
    const input: MeshcoreWaitingMessagesStatusInput = {
      ...baseInput,
      waitingMessagesDrainDeferred: true,
      connectionType: 'serial',
    };
    expect(meshcoreWaitingMessagesClickableSync(input)).toBe(false);
    expect(meshcoreWaitingMessagesStatusText(t, input)).toBe('Drain deferred (serial hint)');
  });

  it('reports queued idle with sync-now suffix', () => {
    const input: MeshcoreWaitingMessagesStatusInput = {
      ...baseInput,
      waitingMessagesCount: 4,
    };
    expect(meshcoreWaitingMessagesClickableSync(input)).toBe(true);
    expect(meshcoreWaitingMessagesStatusText(t, input)).toBe('4 queued Sync now');
  });
});

describe('meshcoreWaitingMessagesVisibleForProtocol', () => {
  it('hides deferred-only state off the MeshCore tab', () => {
    const input: MeshcoreWaitingMessagesStatusInput = {
      ...baseInput,
      waitingMessagesDrainDeferred: true,
    };
    expect(meshcoreWaitingMessagesVisible(input)).toBe(true);
    expect(meshcoreWaitingMessagesVisibleForProtocol(input, 'meshcore')).toBe(true);
    expect(meshcoreWaitingMessagesVisibleForProtocol(input, 'meshtastic')).toBe(false);
    expect(meshcoreWaitingMessagesVisibleForProtocol(input, 'reticulum')).toBe(false);
  });

  it('keeps queued backlog visible cross-tab', () => {
    const input: MeshcoreWaitingMessagesStatusInput = {
      ...baseInput,
      waitingMessagesCount: 2,
    };
    expect(meshcoreWaitingMessagesVisibleForProtocol(input, 'meshtastic')).toBe(true);
    expect(meshcoreWaitingMessagesVisibleForProtocol(input, 'meshcore')).toBe(true);
  });

  it('hides active sync off the MeshCore tab', () => {
    const silentDrain: MeshcoreWaitingMessagesStatusInput = {
      ...baseInput,
      waitingMessagesSilentDrainActive: true,
    };
    expect(meshcoreWaitingMessagesVisibleForProtocol(silentDrain, 'meshcore')).toBe(true);
    expect(meshcoreWaitingMessagesVisibleForProtocol(silentDrain, 'meshtastic')).toBe(false);
    expect(meshcoreWaitingMessagesVisibleForProtocol(silentDrain, 'reticulum')).toBe(false);

    const manualSync: MeshcoreWaitingMessagesStatusInput = {
      ...baseInput,
      waitingMessagesSyncActive: true,
    };
    expect(meshcoreWaitingMessagesVisibleForProtocol(manualSync, 'meshcore')).toBe(true);
    expect(meshcoreWaitingMessagesVisibleForProtocol(manualSync, 'meshtastic')).toBe(false);
  });
});
