// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

vi.mock('../../components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

import { pushAppToast } from '../../components/Toast';
import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import { MESHCORE_CONTACTS_FULL_ALARM_DEBOUNCE_MS } from '../timeConstants';
import {
  applyMeshcoreContactDeletedFromRadio,
  handleMeshcoreContactsFullPush,
  isMeshcoreFirmwareContactsFullActive,
  registerMeshcoreContactsFullOffloadRunner,
  resetMeshcoreContactCapacityPushForTests,
  writeMeshcoreAutoOffloadWhenFull,
} from './meshcoreContactCapacityPush';

describe('meshcoreContactCapacityPush', () => {
  const identityId = 'meshcore:test';

  beforeEach(() => {
    resetMeshcoreContactCapacityPushForTests();
    writeMeshcoreAutoOffloadWhenFull(false);
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    vi.mocked(pushAppToast).mockClear();
    vi.mocked(window.electronAPI.db.markMeshcoreContactOffRadio).mockReset();
    vi.mocked(window.electronAPI.db.markMeshcoreContactOffRadio).mockResolvedValue({ changes: 1 });
    vi.mocked(window.electronAPI.db.offloadAllMeshcoreContacts).mockClear();
  });

  it('marks only the deleted contact off-radio and does not zero the capacity count', async () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const nodeId = 0xabcdef01;
    upsertNodeRecord(identityId, {
      nodeId,
      longName: 'Evicted',
      onRadio: true,
      publicKey,
    });

    const result = await applyMeshcoreContactDeletedFromRadio({
      identityId,
      nodeId,
      publicKey,
    });

    expect(result.markedOffRadio).toBe(true);
    expect(window.electronAPI.db.markMeshcoreContactOffRadio).toHaveBeenCalledTimes(1);
    const hexArg = vi.mocked(window.electronAPI.db.markMeshcoreContactOffRadio).mock.calls[0][0];
    expect(hexArg).toHaveLength(64);
    expect(useNodeStore.getState().nodes[identityId][nodeId].onRadio).toBe(false);
    expect(window.electronAPI.db.offloadAllMeshcoreContacts).not.toHaveBeenCalled();
  });

  it('alarms with Offload CTA when auto-offload is off', () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    registerMeshcoreContactsFullOffloadRunner(runner);

    handleMeshcoreContactsFullPush(1_000);
    expect(isMeshcoreFirmwareContactsFullActive()).toBe(true);
    expect(pushAppToast).toHaveBeenCalledWith(
      'radioPanel.contactsFullAlarm',
      'error',
      20_000,
      expect.objectContaining({
        action: expect.objectContaining({ label: 'radioPanel.contactsFullAlarmAction' }),
      }),
    );
    expect(runner).not.toHaveBeenCalled();

    handleMeshcoreContactsFullPush(1_000 + MESHCORE_CONTACTS_FULL_ALARM_DEBOUNCE_MS - 1);
    expect(pushAppToast).toHaveBeenCalledTimes(1);
  });

  it('auto-offloads when preference is enabled', async () => {
    writeMeshcoreAutoOffloadWhenFull(true);
    const runner = vi.fn().mockResolvedValue(undefined);
    registerMeshcoreContactsFullOffloadRunner(runner);

    handleMeshcoreContactsFullPush(5_000);
    expect(pushAppToast).toHaveBeenCalledWith(
      'radioPanel.contactsFullAutoOffloadStarted',
      'warning',
      6000,
    );
    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(1);
    });
  });

  it('debounces auto-offload toasts and runner while cooldown is active', async () => {
    writeMeshcoreAutoOffloadWhenFull(true);
    const runner = vi.fn().mockRejectedValue(new Error('offload failed'));
    registerMeshcoreContactsFullOffloadRunner(runner);

    handleMeshcoreContactsFullPush(10_000);
    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(1);
      expect(pushAppToast).toHaveBeenCalledTimes(2);
    });

    handleMeshcoreContactsFullPush(10_000 + MESHCORE_CONTACTS_FULL_ALARM_DEBOUNCE_MS - 1);
    expect(pushAppToast).toHaveBeenCalledTimes(2);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
