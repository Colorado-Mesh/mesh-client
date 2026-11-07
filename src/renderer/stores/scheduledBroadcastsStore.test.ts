import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withMockedConsoleWarn } from '../lib/vitestConsoleMock';
import {
  hydrateScheduledBroadcastsStore,
  resetScheduledBroadcastsStoreForTests,
  useScheduledBroadcastsStore,
} from './scheduledBroadcastsStore';

const list = vi.fn();
const save = vi.fn();
const del = vi.fn();
const clear = vi.fn();

beforeEach(() => {
  resetScheduledBroadcastsStoreForTests();
  list.mockReset();
  save.mockReset();
  del.mockReset();
  clear.mockReset();
  list.mockResolvedValue([]);
  window.electronAPI = {
    ...window.electronAPI,
    db: {
      ...window.electronAPI.db,
      listScheduledBroadcasts: list,
      saveScheduledBroadcast: save,
      deleteScheduledBroadcast: del,
      clearScheduledBroadcasts: clear,
    },
  };
});

describe('scheduledBroadcastsStore', () => {
  it('hydrates empty DB into 12 null slots', async () => {
    await hydrateScheduledBroadcastsStore();
    const { hydrated, slots } = useScheduledBroadcastsStore.getState();
    expect(hydrated).toBe(true);
    expect(Object.keys(slots)).toHaveLength(12);
    expect(slots[1]).toBeNull();
  });

  it('hydrates existing rows by slot', async () => {
    list.mockResolvedValue([
      {
        slot: 3,
        label: 'L',
        text: 'T',
        enabled: true,
        interval: 'daily',
        timeOfDayMin: 540,
        weekday: null,
        dayOfMonth: null,
        anchorYmd: null,
        nextDueAt: null,
        lastAttemptAt: null,
        lastResult: null,
        targets: [],
        updatedAt: 1,
      },
    ]);
    await hydrateScheduledBroadcastsStore();
    expect(useScheduledBroadcastsStore.getState().slots[3]?.text).toBe('T');
  });

  it('save updates state from IPC return; failed write keeps previous', async () => {
    await hydrateScheduledBroadcastsStore();
    const row = {
      slot: 1,
      label: '',
      text: 'ok',
      enabled: false,
      interval: 'weekly' as const,
      timeOfDayMin: 540,
      weekday: 0,
      dayOfMonth: null,
      anchorYmd: null,
      nextDueAt: null,
      lastAttemptAt: null,
      lastResult: null,
      targets: [],
      updatedAt: 2,
    };
    save.mockResolvedValueOnce(row);
    await useScheduledBroadcastsStore.getState().save({ slot: 1, text: 'ok' });
    expect(useScheduledBroadcastsStore.getState().slots[1]?.text).toBe('ok');

    save.mockRejectedValueOnce(new Error('fail'));
    await withMockedConsoleWarn(async () => {
      await expect(
        useScheduledBroadcastsStore.getState().save({ slot: 1, text: 'nope' }),
      ).rejects.toThrow('fail');
    });
    expect(useScheduledBroadcastsStore.getState().slots[1]?.text).toBe('ok');
  });

  it('clearAll empties slots', async () => {
    await hydrateScheduledBroadcastsStore();
    save.mockResolvedValue({
      slot: 1,
      label: '',
      text: 'x',
      enabled: false,
      interval: 'weekly',
      timeOfDayMin: 540,
      weekday: null,
      dayOfMonth: null,
      anchorYmd: null,
      nextDueAt: null,
      lastAttemptAt: null,
      lastResult: null,
      targets: [],
      updatedAt: 1,
    });
    await useScheduledBroadcastsStore.getState().save({ slot: 1, text: 'x' });
    clear.mockResolvedValue(undefined);
    await useScheduledBroadcastsStore.getState().clearAll();
    expect(useScheduledBroadcastsStore.getState().slots[1]).toBeNull();
  });

  it('applyRuntimeState does not call save IPC', async () => {
    await hydrateScheduledBroadcastsStore();
    save.mockResolvedValue({
      slot: 1,
      label: '',
      text: 'x',
      enabled: true,
      interval: 'daily',
      timeOfDayMin: 540,
      weekday: null,
      dayOfMonth: null,
      anchorYmd: null,
      nextDueAt: 100,
      lastAttemptAt: null,
      lastResult: null,
      targets: [],
      updatedAt: 1,
    });
    await useScheduledBroadcastsStore.getState().save({ slot: 1, text: 'x' });
    save.mockClear();
    useScheduledBroadcastsStore.getState().applyRuntimeState(1, {
      nextDueAt: 200,
      lastAttemptAt: 150,
      lastResult: { at: 150, outcome: 'missed', targets: [] },
    });
    expect(save).not.toHaveBeenCalled();
    expect(useScheduledBroadcastsStore.getState().slots[1]?.nextDueAt).toBe(200);
  });
});
