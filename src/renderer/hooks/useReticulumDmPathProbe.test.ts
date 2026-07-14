import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const probeReticulumPeerMock = vi.fn();
const updatePeerMock = vi.fn();
const refreshPeersMock = vi.fn();

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  probeReticulumPeer: (...args: unknown[]) => probeReticulumPeerMock(...args),
}));

vi.mock('@/renderer/stores/reticulumPeerStore', () => ({
  useReticulumPeerStore: {
    getState: () => ({
      updatePeer: (...args: unknown[]) => updatePeerMock(...args),
    }),
  },
  refreshReticulumPeersFromSidecar: (...args: unknown[]) => refreshPeersMock(...args),
}));

import { useReticulumDmPathProbe } from './useReticulumDmPathProbe';

describe('useReticulumDmPathProbe', () => {
  beforeEach(() => {
    probeReticulumPeerMock.mockReset();
    updatePeerMock.mockReset();
    refreshPeersMock.mockReset();
    refreshPeersMock.mockResolvedValue([]);
  });

  it('probes when enabled and destination hash is set', async () => {
    probeReticulumPeerMock.mockResolvedValue({ ok: true, hops: 2 });
    const { result } = renderHook(() =>
      useReticulumDmPathProbe({
        enabled: true,
        destinationHash: 'aabbccddeeff00112233445566778899',
        passiveHops: null,
      }),
    );
    expect(result.current.status).toBe('probing');
    await waitFor(() => {
      expect(result.current.status).toBe('reachable');
    });
    expect(result.current.hops).toBe(2);
    expect(probeReticulumPeerMock).toHaveBeenCalledWith('aabbccddeeff00112233445566778899');
    expect(updatePeerMock).toHaveBeenCalledWith('aabbccddeeff00112233445566778899', { hops: 2 });
    expect(refreshPeersMock).toHaveBeenCalled();
  });

  it('reprobe re-runs the sidecar probe', async () => {
    probeReticulumPeerMock
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, hops: 1 });
    const { result } = renderHook(() =>
      useReticulumDmPathProbe({
        enabled: true,
        destinationHash: 'aabbccddeeff00112233445566778899',
        passiveHops: null,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('unreachable');
    });
    act(() => {
      result.current.reprobe();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('reachable');
    });
    expect(result.current.hops).toBe(1);
    expect(probeReticulumPeerMock).toHaveBeenCalledTimes(2);
  });

  it('ignores stale probe results after destination switch', async () => {
    let resolveFirst!: (value: { ok: boolean; hops?: number }) => void;
    const first = new Promise<{ ok: boolean; hops?: number }>((resolve) => {
      resolveFirst = resolve;
    });
    probeReticulumPeerMock.mockReturnValueOnce(first).mockResolvedValueOnce({ ok: false });

    const { result, rerender } = renderHook(
      ({ hash }: { hash: string }) =>
        useReticulumDmPathProbe({
          enabled: true,
          destinationHash: hash,
          passiveHops: null,
        }),
      { initialProps: { hash: '11111111111111111111111111111111' } },
    );

    rerender({ hash: '22222222222222222222222222222222' });
    await waitFor(() => {
      expect(result.current.status).toBe('unreachable');
    });

    act(() => {
      resolveFirst({ ok: true, hops: 9 });
    });
    expect(result.current.status).toBe('unreachable');
    expect(result.current.hops).toBeNull();
  });

  it('seeds reachable from passive hops then confirms probe', async () => {
    probeReticulumPeerMock.mockResolvedValue({ ok: true, hops: 1 });
    const { result } = renderHook(() =>
      useReticulumDmPathProbe({
        enabled: true,
        destinationHash: 'aabbccddeeff00112233445566778899',
        passiveHops: 3,
      }),
    );
    expect(result.current.status).toBe('reachable');
    expect(result.current.hops).toBe(3);
    await waitFor(() => {
      expect(result.current.hops).toBe(1);
    });
  });

  it('resets to idle when disabled', async () => {
    probeReticulumPeerMock.mockResolvedValue({ ok: true, hops: 1 });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useReticulumDmPathProbe({
          enabled,
          destinationHash: 'aabbccddeeff00112233445566778899',
        }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('reachable');
    });
    rerender({ enabled: false });
    expect(result.current.status).toBe('idle');
    expect(result.current.hops).toBeNull();
  });

  it('settles to unreachable when probeReticulumPeer rejects', async () => {
    probeReticulumPeerMock.mockRejectedValue(new Error('sidecar down'));
    const { result } = renderHook(() =>
      useReticulumDmPathProbe({
        enabled: true,
        destinationHash: 'aabbccddeeff00112233445566778899',
        passiveHops: null,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('unreachable');
    });
    expect(result.current.hops).toBeNull();
    expect(refreshPeersMock).not.toHaveBeenCalled();
  });

  it('reprobe forces probing even when passive hops are known', async () => {
    let resolveSecond!: (value: { ok: boolean; hops?: number }) => void;
    const second = new Promise<{ ok: boolean; hops?: number }>((resolve) => {
      resolveSecond = resolve;
    });
    probeReticulumPeerMock.mockResolvedValueOnce({ ok: true, hops: 3 }).mockReturnValueOnce(second);

    const { result } = renderHook(() =>
      useReticulumDmPathProbe({
        enabled: true,
        destinationHash: 'aabbccddeeff00112233445566778899',
        passiveHops: 3,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('reachable');
      expect(result.current.hops).toBe(3);
    });

    act(() => {
      result.current.reprobe();
    });
    expect(result.current.status).toBe('probing');

    act(() => {
      resolveSecond({ ok: true, hops: 1 });
    });
    await waitFor(() => {
      expect(result.current.status).toBe('reachable');
      expect(result.current.hops).toBe(1);
    });
    expect(probeReticulumPeerMock).toHaveBeenCalledTimes(2);
  });

  it('applyProbeResult updates status and hops without another probe', async () => {
    probeReticulumPeerMock.mockResolvedValue({ ok: true, hops: 1 });
    const { result } = renderHook(() =>
      useReticulumDmPathProbe({
        enabled: true,
        destinationHash: 'aabbccddeeff00112233445566778899',
        passiveHops: null,
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('reachable');
    });
    const callsAfterAuto = probeReticulumPeerMock.mock.calls.length;

    act(() => {
      result.current.applyProbeResult(false, null);
    });
    expect(result.current.status).toBe('unreachable');
    expect(result.current.hops).toBeNull();

    act(() => {
      result.current.applyProbeResult(true, 4);
    });
    expect(result.current.status).toBe('reachable');
    expect(result.current.hops).toBe(4);
    expect(probeReticulumPeerMock).toHaveBeenCalledTimes(callsAfterAuto);
  });
});
