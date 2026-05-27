import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetStartupDbPruneForTests, runStartupDbPrune } from './startupDbPrune';
import { MESH_PROTOCOL_STORAGE_KEY } from './storedMeshProtocol';

describe('runStartupDbPrune', () => {
  beforeEach(() => {
    resetStartupDbPruneForTests();
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
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({});
  });

  afterEach(() => {
    resetStartupDbPruneForTests();
    vi.mocked(window.electronAPI.db.migrateRfStubNodes).mockClear();
    vi.mocked(window.electronAPI.db.deleteNodesNeverHeard).mockClear();
    vi.mocked(window.electronAPI.db.pruneNodesByCount).mockClear();
    vi.mocked(window.electronAPI.db.deleteNodesWithoutLongname).mockClear();
    vi.mocked(window.electronAPI.db.pruneMessagesByCount).mockClear();
    vi.mocked(window.electronAPI.db.pruneMeshcoreMessagesByCount).mockClear();
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
  });

  it('does not re-run when invoked again after concurrent callers', async () => {
    await Promise.all([runStartupDbPrune(), runStartupDbPrune(), runStartupDbPrune()]);

    expect(window.electronAPI.db.pruneMessagesByCount).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.db.pruneMeshcoreMessagesByCount).toHaveBeenCalledTimes(1);
  });
});
