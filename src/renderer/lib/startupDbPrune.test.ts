import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetReticulumVacuumScheduleForTests,
  resetStartupDbPruneForTests,
  runSessionDbPrune,
  runStartupDbPrune,
  scheduleReticulumVacuumIfNeeded,
} from './startupDbPrune';
import { MESH_PROTOCOL_STORAGE_KEY } from './storedMeshProtocol';

describe('runStartupDbPrune', () => {
  beforeEach(() => {
    resetStartupDbPruneForTests();
    resetReticulumVacuumScheduleForTests();
    localStorage.clear();
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshtastic');
    localStorage.setItem(
      'mesh-client:appSettings',
      JSON.stringify({
        autoPruneEnabled: false,
        nodeCapEnabled: true,
        pruneEmptyNamesEnabled: true,
        positionHistoryPruneEnabled: false,
      }),
    );

    vi.mocked(window.electronAPI.db.migrateRfStubNodes).mockResolvedValue(0);
    vi.mocked(window.electronAPI.db.deleteNodesNeverHeard).mockResolvedValue(0);
    vi.mocked(window.electronAPI.db.pruneNodesByCount).mockResolvedValue({ changes: 0 });
    vi.mocked(window.electronAPI.db.deleteNodesWithoutLongname).mockResolvedValue(0);
    vi.mocked(window.electronAPI.db.pruneMessagesByCount).mockResolvedValue({ changes: 0 });
    vi.mocked(window.electronAPI.db.pruneMeshcoreMessagesByCount).mockResolvedValue({ changes: 0 });
    vi.mocked(window.electronAPI.db.pruneReticulumMessagesByCount).mockResolvedValue({
      changes: 0,
    });
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({});
  });

  afterEach(() => {
    resetStartupDbPruneForTests();
    resetReticulumVacuumScheduleForTests();
    vi.mocked(window.electronAPI.db.migrateRfStubNodes).mockClear();
    vi.mocked(window.electronAPI.db.deleteNodesNeverHeard).mockClear();
    vi.mocked(window.electronAPI.db.pruneNodesByCount).mockClear();
    vi.mocked(window.electronAPI.db.deleteNodesWithoutLongname).mockClear();
    vi.mocked(window.electronAPI.db.pruneMessagesByCount).mockClear();
    vi.mocked(window.electronAPI.db.pruneMeshcoreMessagesByCount).mockClear();
    vi.mocked(window.electronAPI.db.pruneReticulumMessagesByCount).mockClear();
  });

  it('runs meshtastic startup prune IPC once per session', async () => {
    await runStartupDbPrune();
    await runStartupDbPrune();

    expect(window.electronAPI.db.migrateRfStubNodes).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.db.deleteNodesNeverHeard).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.db.pruneNodesByCount).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.db.deleteNodesWithoutLongname).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.db.pruneMessagesByCount).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.db.pruneMeshcoreMessagesByCount).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.db.pruneReticulumMessagesByCount).toHaveBeenCalledTimes(1);
  });

  it('runSessionDbPrune repeats after prior run settles (single-flight only while in-flight)', async () => {
    await runStartupDbPrune();
    await runSessionDbPrune();
    await runSessionDbPrune();

    expect(window.electronAPI.db.pruneReticulumMessagesByCount).toHaveBeenCalledTimes(3);
  });

  it('coalesces concurrent session prune callers', async () => {
    await runStartupDbPrune();
    vi.mocked(window.electronAPI.db.pruneReticulumMessagesByCount).mockClear();
    await Promise.all([runSessionDbPrune(), runSessionDbPrune(), runSessionDbPrune()]);
    expect(window.electronAPI.db.pruneReticulumMessagesByCount).toHaveBeenCalledTimes(1);
  });

  it('does not re-run when invoked again after concurrent callers', async () => {
    await Promise.all([runStartupDbPrune(), runStartupDbPrune(), runStartupDbPrune()]);

    expect(window.electronAPI.db.pruneMessagesByCount).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.db.pruneMeshcoreMessagesByCount).toHaveBeenCalledTimes(1);
  });

  it('runs reticulum destination prune without startup vacuum', async () => {
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'reticulum');
    localStorage.setItem(
      'mesh-client:appSettings',
      JSON.stringify({
        reticulumAutoPruneEnabled: true,
        reticulumAutoPruneDays: 14,
        reticulumDestinationCapEnabled: true,
        reticulumDestinationCapCount: 1234,
      }),
    );
    const deleteByAge = vi.fn().mockResolvedValue({ changes: 0 });
    const pruneActivity = vi.fn().mockResolvedValue({ changes: 0 });
    const pruneByCount = vi.fn().mockResolvedValue({ changes: 0 });
    const vacuum = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.db).deleteReticulumDestinationsByAge = deleteByAge;
    vi.mocked(window.electronAPI.db).pruneReticulumIdentityActivityByAge = pruneActivity;
    vi.mocked(window.electronAPI.db).pruneReticulumDestinationsByCount = pruneByCount;
    vi.mocked(window.electronAPI.db).vacuumReticulumTables = vacuum;

    await runStartupDbPrune();
    expect(deleteByAge).toHaveBeenCalledWith(14);
    expect(pruneActivity).toHaveBeenCalledWith(14);
    expect(pruneByCount).toHaveBeenCalledWith(1234);
    expect(vacuum).not.toHaveBeenCalled();

    deleteByAge.mockClear();
    vacuum.mockClear();
    await runSessionDbPrune();
    expect(deleteByAge).toHaveBeenCalledTimes(1);
    expect(vacuum).not.toHaveBeenCalled();
  });
});

describe('scheduleReticulumVacuumIfNeeded', () => {
  beforeEach(() => {
    resetReticulumVacuumScheduleForTests();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetReticulumVacuumScheduleForTests();
    vi.useRealTimers();
  });

  it('schedules idle vacuum once when never vacuumed', async () => {
    const vacuum = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.db).vacuumReticulumTables = vacuum;

    scheduleReticulumVacuumIfNeeded();
    scheduleReticulumVacuumIfNeeded();
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.resolve();

    expect(vacuum).toHaveBeenCalledTimes(1);
  });

  it('skips when vacuumed recently', () => {
    const vacuum = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.db).vacuumReticulumTables = vacuum;
    localStorage.setItem('mesh-client:lastReticulumVacuumMs', String(Date.now()));

    scheduleReticulumVacuumIfNeeded();
    void vi.advanceTimersByTimeAsync(30_000);

    expect(vacuum).not.toHaveBeenCalled();
  });
});
