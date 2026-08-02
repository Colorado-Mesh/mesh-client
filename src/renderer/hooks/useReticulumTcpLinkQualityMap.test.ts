import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isReticulumTcpClientLinkQualityRow,
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
    vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockResolvedValue(42);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('probes enabled TCP rows and stores RTT by id', async () => {
    const { result } = renderHook(() =>
      useReticulumTcpLinkQualityMap(
        [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
        true,
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
        true,
      ),
    );
    await waitFor(() => {
      expect(result.current.has('hub')).toBe(true);
      expect(result.current.get('hub')).toBeNull();
    });
  });

  it('clears map when sidecar is not ready', () => {
    const { result } = renderHook(() =>
      useReticulumTcpLinkQualityMap(
        [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
        false,
      ),
    );
    expect(result.current.size).toBe(0);
    expect(window.electronAPI.hostLink.probeTcpRtt).not.toHaveBeenCalled();
  });

  it('does not restart TCP probe poll when interfaces array identity churns', async () => {
    const { result } = renderHook(() =>
      useReticulumTcpLinkQualityMap(
        [{ id: 'hub', enabled: true, type: 'tcp', host: 'rmap.world', port: 4242 }],
        true,
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
});
