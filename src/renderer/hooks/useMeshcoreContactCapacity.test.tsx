import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMeshcoreContactCapacity } from './useMeshcoreContactCapacity';

describe('useMeshcoreContactCapacity', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.db.getMeshcoreContactCount).mockResolvedValue(350);
    vi.mocked(window.electronAPI.db.offloadAllMeshcoreContacts).mockResolvedValue(10);
  });

  it('reconciles count after offload and refresh callback', async () => {
    const refreshContacts = vi.fn().mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.db.getMeshcoreContactCount)
      .mockResolvedValueOnce(350)
      .mockResolvedValueOnce(350);

    const { result } = renderHook(() => useMeshcoreContactCapacity());

    await waitFor(() => {
      expect(result.current.contactCount).toBe(350);
    });

    await act(async () => {
      await result.current.offloadAndReconcile(refreshContacts);
    });

    expect(refreshContacts).toHaveBeenCalledTimes(1);
    expect(result.current.contactCount).toBe(350);
  });

  it('keeps previous count when reconciliation fetch fails', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreContactCount)
      .mockResolvedValueOnce(330)
      .mockRejectedValueOnce(new Error('read failed'));
    const refreshContacts = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useMeshcoreContactCapacity());
    await waitFor(() => {
      expect(result.current.contactCount).toBe(330);
    });

    await act(async () => {
      await result.current.offloadAndReconcile(refreshContacts);
    });

    expect(result.current.contactCount).toBe(330);
  });
});
