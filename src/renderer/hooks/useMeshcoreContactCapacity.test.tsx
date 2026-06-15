import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MeshcoreOffloadAbortedError,
  type MeshcoreOffloadFromRadioOptions,
} from '../lib/meshcoreOffload';
import { useMeshcoreContactCapacity } from './useMeshcoreContactCapacity';

describe('useMeshcoreContactCapacity', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.db.getMeshcoreContactCount).mockReset();
    vi.mocked(window.electronAPI.db.getMeshcoreContactCount).mockResolvedValue(350);
    vi.mocked(window.electronAPI.db.offloadAllMeshcoreContacts).mockReset();
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

  it('skips db offload and runs refresh cleanup when radio offload is aborted', async () => {
    const refreshContacts = vi.fn().mockResolvedValue(undefined);
    const controller = new AbortController();
    const offloadFromRadio = vi.fn((options?: MeshcoreOffloadFromRadioOptions) => {
      options?.onProgress?.({ phase: 'removing', current: 1, total: 3 });
      controller.abort();
      return Promise.reject(new MeshcoreOffloadAbortedError(1));
    });

    const { result } = renderHook(() => useMeshcoreContactCapacity());

    await waitFor(() => {
      expect(result.current.contactCount).toBe(350);
    });

    await act(async () => {
      await expect(
        result.current.offloadAndReconcile(refreshContacts, offloadFromRadio),
      ).rejects.toBeInstanceOf(MeshcoreOffloadAbortedError);
    });

    expect(window.electronAPI.db.offloadAllMeshcoreContacts).not.toHaveBeenCalled();
    expect(refreshContacts).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.offloadProgress).toBeNull();
  });

  it('cancelOffload aborts an in-flight offload', async () => {
    const refreshContacts = vi.fn().mockResolvedValue(undefined);
    const offloadFromRadio = vi.fn(
      (options?: MeshcoreOffloadFromRadioOptions) =>
        new Promise<number>((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              reject(new MeshcoreOffloadAbortedError(0));
            },
            { once: true },
          );
        }),
    );

    const { result } = renderHook(() => useMeshcoreContactCapacity());

    await waitFor(() => {
      expect(result.current.contactCount).toBe(350);
    });

    let offloadPromise: Promise<unknown>;
    act(() => {
      offloadPromise = result.current.offloadAndReconcile(refreshContacts, offloadFromRadio);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    act(() => {
      result.current.cancelOffload();
    });

    await act(async () => {
      await expect(offloadPromise!).rejects.toBeInstanceOf(MeshcoreOffloadAbortedError);
    });

    expect(result.current.loading).toBe(false);
    expect(window.electronAPI.db.offloadAllMeshcoreContacts).not.toHaveBeenCalled();
  });
});
