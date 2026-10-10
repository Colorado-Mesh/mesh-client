import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetStartupDbPruneForTests,
  runSessionDbPrune,
  runStartupDbPrune,
} from './startupDbPrune';
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

  it('prunes environment telemetry history on startup', async () => {
    vi.mocked(window.electronAPI.db.pruneEnvironmentTelemetry).mockClear();
    await runStartupDbPrune();
    expect(window.electronAPI.db.pruneEnvironmentTelemetry).toHaveBeenCalledTimes(1);
  });

  it('does not re-run when invoked again after concurrent callers', async () => {
    await Promise.all([runStartupDbPrune(), runStartupDbPrune(), runStartupDbPrune()]);

    expect(window.electronAPI.db.pruneMessagesByCount).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.db.pruneMeshcoreMessagesByCount).toHaveBeenCalledTimes(1);
  });

  it('forwards incident exempt node ids to position-history prunes', async () => {
    localStorage.setItem(
      'mesh-client:appSettings',
      JSON.stringify({ positionHistoryPruneEnabled: true, positionHistoryPruneDays: 5 }),
    );
    const prunePosition = vi.fn().mockResolvedValue(0);
    const prunePositionPerNode = vi.fn().mockResolvedValue(0);
    vi.mocked(window.electronAPI.db).prunePositionHistory = prunePosition;
    vi.mocked(window.electronAPI.db).prunePositionHistoryPerNode = prunePositionPerNode;

    await runSessionDbPrune({ exemptNodeIds: new Set(['!abcd1234', '!0000beef']) });

    expect(prunePosition).toHaveBeenCalledWith(5, ['!abcd1234', '!0000beef']);
    expect(prunePositionPerNode).toHaveBeenCalledWith(2000, ['!abcd1234', '!0000beef']);
  });

  it('omits exempt arg when no exempt node ids are provided', async () => {
    localStorage.setItem(
      'mesh-client:appSettings',
      JSON.stringify({ positionHistoryPruneEnabled: true, positionHistoryPruneDays: 5 }),
    );
    const prunePosition = vi.fn().mockResolvedValue(0);
    vi.mocked(window.electronAPI.db).prunePositionHistory = prunePosition;
    vi.mocked(window.electronAPI.db).prunePositionHistoryPerNode = vi.fn().mockResolvedValue(0);

    await runSessionDbPrune({ exemptNodeIds: [] });

    expect(prunePosition.mock.calls[0]).toEqual([5]);
  });
});
