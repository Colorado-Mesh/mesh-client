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
import { packetRouter } from '../drivers/PacketRouter';
import { isMeshcoreTableFullError } from '../meshcoreRadioErr';
import { MESHCORE_CONTACTS_FULL_ALARM_DEBOUNCE_MS } from '../timeConstants';
import {
  applyMeshcoreContactDeletedFromRadio,
  attachMeshcoreContactCapacityPush,
  endMeshcoreOffload,
  getMeshcoreRadioMaxContacts,
  handleMeshcoreContactsFullPush,
  isMeshcoreAutoOffloadInFlight,
  isMeshcoreFirmwareContactsFullActive,
  maybeRequestMeshcoreAutoOffloadForCount,
  maybeRequestMeshcoreAutoOffloadForError,
  registerMeshcoreContactsFullOffloadRunner,
  requestMeshcoreAutoOffload,
  resetMeshcoreContactCapacityPushForTests,
  setMeshcoreRadioMaxContacts,
  tryBeginMeshcoreOffload,
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

  it.each(['firmware_full', 'count_threshold', 'table_full_error', 'overwrite_eviction'] as const)(
    'runs the offload runner for reason %s when auto-offload is on',
    async (reason) => {
      writeMeshcoreAutoOffloadWhenFull(true);
      const runner = vi.fn().mockResolvedValue(undefined);
      registerMeshcoreContactsFullOffloadRunner(runner);

      requestMeshcoreAutoOffload(reason, 1_000);
      await vi.waitFor(() => {
        expect(runner).toHaveBeenCalledTimes(1);
      });
    },
  );

  it('does not start a second offload while one is in flight', async () => {
    writeMeshcoreAutoOffloadWhenFull(true);
    let finish: () => void = () => {};
    const runner = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    registerMeshcoreContactsFullOffloadRunner(runner);

    requestMeshcoreAutoOffload('count_threshold', 1_000);
    requestMeshcoreAutoOffload(
      'overwrite_eviction',
      1_000 + MESHCORE_CONTACTS_FULL_ALARM_DEBOUNCE_MS + 1,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(1);
    });
  });

  it('stays silent for count/eviction signals when auto-offload is off', () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    registerMeshcoreContactsFullOffloadRunner(runner);

    requestMeshcoreAutoOffload('count_threshold', 1_000);
    requestMeshcoreAutoOffload('overwrite_eviction', 2_000);
    expect(runner).not.toHaveBeenCalled();
    expect(pushAppToast).not.toHaveBeenCalled();
  });

  it('alarms with Offload CTA for a table-full error when auto-offload is off', () => {
    registerMeshcoreContactsFullOffloadRunner(vi.fn().mockResolvedValue(undefined));

    expect(maybeRequestMeshcoreAutoOffloadForError({ errCode: 3 }, 1_000)).toBe(true);
    expect(isMeshcoreFirmwareContactsFullActive()).toBe(true);
    expect(pushAppToast).toHaveBeenCalledWith(
      'radioPanel.contactsFullAlarm',
      'error',
      20_000,
      expect.anything(),
    );
  });

  it('detects only ERR_CODE_TABLE_FULL errors', () => {
    expect(isMeshcoreTableFullError({ errCode: 3 })).toBe(true);
    expect(isMeshcoreTableFullError({ errCode: 2 })).toBe(false);
    expect(isMeshcoreTableFullError(undefined)).toBe(false);
    expect(isMeshcoreTableFullError(new Error('table full'))).toBe(false);
    expect(maybeRequestMeshcoreAutoOffloadForError({ errCode: 4 })).toBe(false);
  });

  describe('count trigger', () => {
    it('fires at radio max minus the margin (default 350 → 340)', async () => {
      writeMeshcoreAutoOffloadWhenFull(true);
      const runner = vi.fn().mockResolvedValue(undefined);
      registerMeshcoreContactsFullOffloadRunner(runner);

      expect(maybeRequestMeshcoreAutoOffloadForCount(339, 1_000)).toBe(false);
      expect(maybeRequestMeshcoreAutoOffloadForCount(340, 1_000)).toBe(true);
      await vi.waitFor(() => {
        expect(runner).toHaveBeenCalledTimes(1);
      });
    });

    it('uses the radio-reported table size', () => {
      writeMeshcoreAutoOffloadWhenFull(true);
      registerMeshcoreContactsFullOffloadRunner(vi.fn().mockResolvedValue(undefined));
      setMeshcoreRadioMaxContacts(100);
      expect(getMeshcoreRadioMaxContacts()).toBe(100);

      expect(maybeRequestMeshcoreAutoOffloadForCount(89, 1_000)).toBe(false);
      expect(maybeRequestMeshcoreAutoOffloadForCount(90, 1_000)).toBe(true);
    });

    it('does nothing when auto-offload is off', () => {
      const runner = vi.fn().mockResolvedValue(undefined);
      registerMeshcoreContactsFullOffloadRunner(runner);
      expect(maybeRequestMeshcoreAutoOffloadForCount(350, 1_000)).toBe(false);
      expect(runner).not.toHaveBeenCalled();
    });

    it('ignores invalid radio max values', () => {
      setMeshcoreRadioMaxContacts(0);
      expect(getMeshcoreRadioMaxContacts()).toBe(350);
      setMeshcoreRadioMaxContacts(null);
      expect(getMeshcoreRadioMaxContacts()).toBe(350);
    });
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'keeps the alarm debounce when auto-offload removes nothing on %s',
    async () => {
      writeMeshcoreAutoOffloadWhenFull(true);
      const runner = vi.fn().mockResolvedValue(0);
      registerMeshcoreContactsFullOffloadRunner(runner);

      requestMeshcoreAutoOffload('firmware_full', 1_000);
      await vi.waitFor(() => {
        expect(runner).toHaveBeenCalledTimes(1);
      });
      expect(isMeshcoreAutoOffloadInFlight()).toBe(false);

      requestMeshcoreAutoOffload('firmware_full', 1_001);
      expect(runner).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['linux', 'darwin', 'win32'] as const)(
    'clears the alarm debounce after auto-offload removes contacts on %s',
    async () => {
      writeMeshcoreAutoOffloadWhenFull(true);
      const runner = vi.fn().mockResolvedValue(2);
      registerMeshcoreContactsFullOffloadRunner(runner);

      requestMeshcoreAutoOffload('count_threshold', 1_000);
      await vi.waitFor(() => {
        expect(runner).toHaveBeenCalledTimes(1);
      });

      requestMeshcoreAutoOffload('count_threshold', 1_001);
      await vi.waitFor(() => {
        expect(runner).toHaveBeenCalledTimes(2);
      });
    },
  );

  it('shares the offload lock with a manual begin', async () => {
    writeMeshcoreAutoOffloadWhenFull(true);
    const runner = vi.fn().mockResolvedValue(1);
    registerMeshcoreContactsFullOffloadRunner(runner);
    expect(tryBeginMeshcoreOffload()).toBe(true);
    expect(isMeshcoreAutoOffloadInFlight()).toBe(true);

    requestMeshcoreAutoOffload('firmware_full', 1_000);
    expect(runner).not.toHaveBeenCalled();

    endMeshcoreOffload();
    requestMeshcoreAutoOffload('firmware_full', 1_000);
    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(1);
    });
  });

  it('0x8F contact-deleted (overwrite eviction) triggers auto-offload when enabled', async () => {
    writeMeshcoreAutoOffloadWhenFull(true);
    const runner = vi.fn().mockResolvedValue(undefined);
    registerMeshcoreContactsFullOffloadRunner(runner);
    const detach = attachMeshcoreContactCapacityPush(identityId);
    try {
      packetRouter.dispatch(
        {
          type: 'meshcore_contact_deleted',
          payload: { nodeId: 0x01020304, publicKey: new Uint8Array(32).fill(7) },
        },
        identityId,
      );
      await vi.waitFor(() => {
        expect(runner).toHaveBeenCalledTimes(1);
      });
    } finally {
      detach();
    }
  });
});
