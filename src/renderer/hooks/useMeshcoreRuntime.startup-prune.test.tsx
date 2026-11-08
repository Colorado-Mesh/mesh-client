import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@liamcottle/meshcore.js', () => ({
  CayenneLpp: { parse: vi.fn().mockReturnValue([]) },
  Connection: class {
    close = vi.fn().mockResolvedValue(undefined);
    on() {
      return undefined;
    }
    off() {
      return undefined;
    }
    once() {
      return undefined;
    }
    emit() {
      return undefined;
    }
  },
  SerialConnection: class {
    close = vi.fn().mockResolvedValue(undefined);
  },
  WebSerialConnection: class {
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

import { resetStartupDbPruneForTests, runStartupDbPrune } from '../lib/startupDbPrune';
import { type ConsoleWarnMock, mockConsoleWarn } from '../lib/vitestConsoleMock';
import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';
import { resetMeshcoreRuntimeElectronMocks } from '../vitestClearHelpers';

describe('useMeshcoreRuntime mount load and the startup prune', () => {
  let warn: ConsoleWarnMock;

  beforeEach(() => {
    warn = mockConsoleWarn();
    resetMeshcoreRuntimeElectronMocks();
    resetStartupDbPruneForTests();
    vi.mocked(window.electronAPI.db.migrateRfStubNodes).mockResolvedValue(0);
  });

  afterEach(() => {
    resetStartupDbPruneForTests();
    vi.mocked(window.electronAPI.db.migrateRfStubNodes).mockResolvedValue(0);
    warn.restore();
  });

  it('reads contacts and messages only after the startup prune settles', async () => {
    let releasePrune: () => void = () => undefined;
    vi.mocked(window.electronAPI.db.migrateRfStubNodes).mockReturnValue(
      new Promise<number>((resolve) => {
        releasePrune = () => {
          resolve(0);
        };
      }),
    );
    let pruneSettled = false;
    const prune = runStartupDbPrune().finally(() => {
      pruneSettled = true;
    });

    renderHook(() => useMeshcoreRuntime());
    await act(async () => {});

    // The prune is still running, so the mount load must not have read SQLite yet.
    expect(pruneSettled).toBe(false);
    expect(window.electronAPI.db.getMeshcoreIdentityHydration).not.toHaveBeenCalled();

    releasePrune();
    await act(async () => {
      await prune;
    });
    await act(async () => {});

    expect(window.electronAPI.db.getMeshcoreIdentityHydration).toHaveBeenCalled();
  });

  it('reads at mount without waiting when no startup prune has started', async () => {
    renderHook(() => useMeshcoreRuntime());
    await act(async () => {});

    expect(window.electronAPI.db.getMeshcoreIdentityHydration).toHaveBeenCalled();
  });
});
