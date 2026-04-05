/**
 * MeshCore contact management: clear-all (DB + memory), apply auto-add (requires connection),
 * refresh auto-add config (no-op when disconnected).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMeshCore } from './useMeshCore';

const APPLY_PARAMS = {
  autoAddAll: true,
  overwriteOldest: false,
  chat: false,
  repeater: false,
  roomServer: false,
  sensor: false,
  maxHopsWire: 0,
} as const;

describe('useMeshCore contact management (no radio connection)', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.clearMeshcoreContacts).mockResolvedValue(undefined);
  });

  it('clearAllMeshcoreContacts clears SQLite and empties nodes when self node id is 0', async () => {
    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreMessages).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.clearAllMeshcoreContacts();
    });

    expect(window.electronAPI.db.clearMeshcoreContacts).toHaveBeenCalledTimes(1);
    expect(result.current.meshcoreContactsForTelemetry).toEqual([]);
    expect(result.current.nodes.size).toBe(0);
  });

  it('applyMeshcoreContactAutoAdd throws when not connected', async () => {
    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreMessages).toHaveBeenCalled();
    });

    await expect(result.current.applyMeshcoreContactAutoAdd(APPLY_PARAMS)).rejects.toThrow(
      'Not connected',
    );
  });

  it('refreshMeshcoreAutoaddFromDevice resolves without error when not connected', async () => {
    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreMessages).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.refreshMeshcoreAutoaddFromDevice();
    });

    expect(result.current.meshcoreAutoadd).toBeNull();
  });
});
