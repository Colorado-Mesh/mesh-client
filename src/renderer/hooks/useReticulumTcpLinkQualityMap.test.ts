import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOST_LINK_QUALITY_POLL_MS } from '../lib/hostLinkQuality';
import { RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS } from '../lib/reticulum/reticulumTcpInterfaceRecovery';
import {
  isReticulumTcpClientLinkQualityRow,
  resetReticulumTcpLinkQualityStickyCacheForTests,
  rttForReticulumTcpRow,
  useReticulumTcpLinkQualityMap,
} from './useReticulumTcpLinkQualityMap';

describe('isReticulumTcpClientLinkQualityRow', () => {
  it('accepts enabled tcp rows with host and port', () => {
    expect(
      isReticulumTcpClientLinkQualityRow({
        id: '1',
        enabled: true,
        type: 'tcp',
        host: 'rmap.world',
        port: 4242,
      }),
    ).toBe(true);
  });

  it('rejects disabled, non-tcp, or incomplete rows', () => {
    expect(
      isReticulumTcpClientLinkQualityRow({
        id: '1',
        enabled: false,
        type: 'tcp',
        host: 'rmap.world',
        port: 4242,
      }),
    ).toBe(false);
    expect(
      isReticulumTcpClientLinkQualityRow({
        id: '1',
        enabled: true,
        type: 'rnode',
        host: 'rmap.world',
        port: 4242,
      }),
    ).toBe(false);
    expect(
      isReticulumTcpClientLinkQualityRow({
        id: '1',
        enabled: true,
        type: 'tcp',
        host: null,
        port: 4242,
      }),
    ).toBe(false);
  });
});

describe('rttForReticulumTcpRow', () => {
  it('returns finite RTT for enabled TCP rows', () => {
    const map = new Map([['hub', 55]]);
    expect(
      rttForReticulumTcpRow({ id: 'hub', enabled: true, type: 'tcp', host: 'h', port: 4242 }, map),
    ).toBe(55);
    expect(
      rttForReticulumTcpRow(
        { id: 'hub', enabled: true, type: 'tcp', host: 'h', port: 4242 },
        new Map([['hub', null]]),
      ),
    ).toBeNull();
  });

  it('returns null when map has null RTT', () => {
    const map = new Map<string, number | null>([['hub', null]]);
    expect(
      rttForReticulumTcpRow({ id: 'hub', enabled: true, type: 'tcp', host: 'h', port: 4242 }, map),
    ).toBeNull();
  });
});

describe('useReticulumTcpLinkQualityMap', () => {
  beforeEach(() => {
    resetReticulumTcpLinkQualityStickyCacheForTests();
    vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockResolvedValue(42);
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetReticulumTcpLinkQualityStickyCacheForTests();
  });

  it('probes enabled TCP rows before the sidecar is ready', async () => {
    const { result } = renderHook(() =>
      useReticulumTcpLinkQualityMap(
        [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
        false,
      ),
    );
    await waitFor(() => {
      expect(result.current.get('hub')).toBe(42);
    });
    expect(window.electronAPI.hostLink.probeTcpRtt).toHaveBeenCalledWith('rmap.world', 4242);
  });

  it('stores null when probe fails', async () => {
    vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockRejectedValue(new Error('timeout'));
    const { result } = renderHook(() =>
      useReticulumTcpLinkQualityMap(
        [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
        false,
      ),
    );
    await waitFor(() => {
      expect(result.current.has('hub')).toBe(true);
      expect(result.current.get('hub')).toBeNull();
    });
  });

  it('seeds once when ready and cache is empty, then stops probing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() =>
      useReticulumTcpLinkQualityMap(
        [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
        true,
      ),
    );
    await waitFor(() => {
      expect(result.current.get('hub')).toBe(42);
    });
    const callsAfterSeed = vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length;
    expect(callsAfterSeed).toBeGreaterThanOrEqual(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOST_LINK_QUALITY_POLL_MS * 3);
    });
    expect(vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length).toBe(
      callsAfterSeed,
    );
    vi.useRealTimers();
  });

  it('second hook mount with ready=true reads sticky cache without re-probing', async () => {
    const first = renderHook(() =>
      useReticulumTcpLinkQualityMap(
        [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
        true,
      ),
    );
    await waitFor(() => {
      expect(first.result.current.get('hub')).toBe(42);
    });
    const callsAfterFirst = vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length;
    first.unmount();

    const second = renderHook(() =>
      useReticulumTcpLinkQualityMap(
        [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
        true,
      ),
    );
    expect(second.result.current.get('hub')).toBe(42);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length).toBe(
      callsAfterFirst,
    );
    second.unmount();
  });

  it('keeps pre-ready RTT after the sidecar becomes ready and does not probe again', async () => {
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) =>
        useReticulumTcpLinkQualityMap(
          [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
          ready,
        ),
      { initialProps: { ready: false } },
    );
    await waitFor(() => {
      expect(result.current.get('hub')).toBe(42);
    });
    const callsAfterProbe = vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length;
    rerender({ ready: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.get('hub')).toBe(42);
    expect(vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length).toBe(
      callsAfterProbe,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'stores null when the probe returns %s',
    async (rtt) => {
      vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockResolvedValue(rtt);
      const { result } = renderHook(() =>
        useReticulumTcpLinkQualityMap(
          [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
          false,
        ),
      );
      await waitFor(() => {
        expect(result.current.has('hub')).toBe(true);
        expect(result.current.get('hub')).toBeNull();
      });
    },
  );

  it('does not restart TCP probe poll when interfaces array identity churns', async () => {
    const { result } = renderHook(() =>
      useReticulumTcpLinkQualityMap(
        [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
        false,
      ),
    );
    await waitFor(() => {
      expect(result.current.get('hub')).toBe(42);
    });
    const afterFirst = vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length;
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length).toBe(afterFirst);
  });

  it('stops post-ready burst after grace even when probes stay null', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockResolvedValue(null);
    renderHook(() =>
      useReticulumTcpLinkQualityMap(
        [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
        true,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOST_LINK_QUALITY_POLL_MS);
    });
    const mid = vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length;
    expect(mid).toBeGreaterThanOrEqual(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS);
      await vi.advanceTimersByTimeAsync(HOST_LINK_QUALITY_POLL_MS * 2);
    });
    const afterGrace = vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOST_LINK_QUALITY_POLL_MS * 3);
    });
    expect(vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mock.calls.length).toBe(afterGrace);
    vi.useRealTimers();
  });
});
