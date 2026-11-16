import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isMeshcoreAutoOffloadInFlight,
  isMeshcoreFirmwareContactsFullActive,
  registerMeshcoreContactsFullOffloadRunner,
  requestMeshcoreAutoOffload,
  resetMeshcoreContactCapacityPushForTests,
  setMeshcoreRadioMaxContacts,
  writeMeshcoreAutoOffloadWhenFull,
} from '../lib/meshcore/meshcoreContactCapacityPush';
import {
  MeshcoreOffloadAbortedError,
  type MeshcoreOffloadFromRadioOptions,
} from '../lib/meshcoreOffload';
import { MESHCORE_DEVICE_INFO_MAX_CONTACTS_CEILING } from '../lib/meshcoreUtils';
import {
  summarizeMeshcoreContactCapacity,
  useMeshcoreContactCapacity,
} from './useMeshcoreContactCapacity';

describe('summarizeMeshcoreContactCapacity', () => {
  it('skips count-based warning/critical when max is the DEVICE_INFO protocol ceiling', () => {
    expect(
      summarizeMeshcoreContactCapacity(500, false, MESHCORE_DEVICE_INFO_MAX_CONTACTS_CEILING),
    ).toEqual({
      count: 500,
      max: MESHCORE_DEVICE_INFO_MAX_CONTACTS_CEILING,
      level: 'normal',
      isWarning: false,
      isCritical: false,
    });
  });

  it('still marks critical when firmware reports contacts-full at the protocol ceiling', () => {
    expect(
      summarizeMeshcoreContactCapacity(500, true, MESHCORE_DEVICE_INFO_MAX_CONTACTS_CEILING),
    ).toEqual({
      count: 500,
      max: MESHCORE_DEVICE_INFO_MAX_CONTACTS_CEILING,
      level: 'critical',
      isWarning: true,
      isCritical: true,
    });
  });

  it('keeps count-based levels for real radio table sizes', () => {
    expect(summarizeMeshcoreContactCapacity(340, false, 350)).toMatchObject({
      level: 'critical',
      isCritical: true,
    });
    expect(summarizeMeshcoreContactCapacity(320, false, 350)).toMatchObject({
      level: 'warning',
      isWarning: true,
      isCritical: false,
    });
  });
});

describe('useMeshcoreContactCapacity', () => {
  beforeEach(() => {
    resetMeshcoreContactCapacityPushForTests();
    writeMeshcoreAutoOffloadWhenFull(false);
    vi.mocked(window.electronAPI.db.getMeshcoreContactCount).mockReset();
    vi.mocked(window.electronAPI.db.getMeshcoreContactCount).mockResolvedValue(350);
    vi.mocked(window.electronAPI.db.offloadAllMeshcoreContacts).mockReset();
    vi.mocked(window.electronAPI.db.offloadAllMeshcoreContacts).mockResolvedValue(10);
  });

  it('reports normal capacity for a high count when radio max is the protocol ceiling', async () => {
    setMeshcoreRadioMaxContacts(MESHCORE_DEVICE_INFO_MAX_CONTACTS_CEILING);
    vi.mocked(window.electronAPI.db.getMeshcoreContactCount).mockResolvedValue(500);

    const { result } = renderHook(() => useMeshcoreContactCapacity());
    await waitFor(() => {
      expect(result.current.contactCount).toBe(500);
    });
    expect(result.current.summary).toEqual({
      count: 500,
      max: MESHCORE_DEVICE_INFO_MAX_CONTACTS_CEILING,
      level: 'normal',
      isWarning: false,
      isCritical: false,
    });
  });

  it('preserves the firmware-full latch when zero contacts leave a full 510 table', async () => {
    setMeshcoreRadioMaxContacts(MESHCORE_DEVICE_INFO_MAX_CONTACTS_CEILING);
    requestMeshcoreAutoOffload('firmware_full', 1_000);
    expect(isMeshcoreFirmwareContactsFullActive()).toBe(true);

    vi.mocked(window.electronAPI.db.getMeshcoreContactCount).mockResolvedValue(510);
    vi.mocked(window.electronAPI.db.offloadAllMeshcoreContacts).mockResolvedValue(0);
    const refreshContacts = vi.fn().mockResolvedValue(undefined);
    const offloadFromRadio = vi.fn().mockResolvedValue(0);

    const { result } = renderHook(() => useMeshcoreContactCapacity());
    await waitFor(() => {
      expect(result.current.contactCount).toBe(510);
    });

    await act(async () => {
      await result.current.offloadAndReconcile(refreshContacts, offloadFromRadio);
    });

    expect(offloadFromRadio).toHaveBeenCalledTimes(1);
    expect(isMeshcoreFirmwareContactsFullActive()).toBe(true);
    expect(result.current.summary.isCritical).toBe(true);
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

  it.each(['linux', 'darwin', 'win32'] as const)(
    'shares one lock with auto-offload on %s',
    async () => {
      writeMeshcoreAutoOffloadWhenFull(true);
      const autoRunner = vi.fn().mockResolvedValue(1);
      registerMeshcoreContactsFullOffloadRunner(autoRunner);
      let release: () => void = () => {};
      const offloadFromRadio = vi.fn(
        () =>
          new Promise<number>((resolve) => {
            release = () => {
              resolve(1);
            };
          }),
      );
      const { result } = renderHook(() => useMeshcoreContactCapacity());
      await waitFor(() => {
        expect(result.current.contactCount).toBe(350);
      });

      let first: Promise<unknown> = Promise.resolve();
      act(() => {
        first = result.current.offloadAndReconcile(undefined, offloadFromRadio);
      });
      await waitFor(() => {
        expect(isMeshcoreAutoOffloadInFlight()).toBe(true);
      });

      await act(async () => {
        await expect(
          result.current.offloadAndReconcile(undefined, offloadFromRadio),
        ).rejects.toThrow('meshcore offload already in progress');
      });
      requestMeshcoreAutoOffload('firmware_full', 1_000);
      expect(offloadFromRadio).toHaveBeenCalledTimes(1);
      expect(autoRunner).not.toHaveBeenCalled();

      await act(async () => {
        release();
        await first;
      });
      expect(isMeshcoreAutoOffloadInFlight()).toBe(false);
    },
  );
});
