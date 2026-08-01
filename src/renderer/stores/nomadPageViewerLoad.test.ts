import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearNomadPageCache,
  getNomadPageCache,
  nomadPageCacheSizeForTests,
} from '@/renderer/lib/nomad/nomadPageCache';
import {
  NOMAD_PAGE_FETCH_DEBOUNCE_MS,
  NOMAD_PAGE_FETCH_RETRY_SETTLE_MS,
} from '@/renderer/lib/timeConstants';
import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

import { resetNomadEgressCacheForTests, useNomadNetworkStore } from './nomadNetworkStore';
import { resetNomadPageViewerStoreForTests, useNomadPageViewerStore } from './nomadPageViewerStore';

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    fetchReticulumInterfaces: vi.fn().mockResolvedValue([]),
  };
});

describe('nomadPageViewerStore loadPage cache', () => {
  beforeEach(() => {
    clearNomadPageCache();
    resetNomadPageViewerStoreForTests();
    resetNomadEgressCacheForTests();
    useNomadNetworkStore.setState({
      nodes: new Map([
        [
          'abc1234567890',
          {
            destination_hash: 'abc1234567890',
            display_name: 'N',
            favorited: false,
            last_seen: 1,
            hops: 1,
          },
        ],
      ]),
      fetchNomadPage: vi.fn().mockResolvedValue({
        ok: true,
        content: 'hello',
        content_type: 'micron',
      }),
    });
  });

  it('second load of the same address uses the session cache', async () => {
    const fetchNomadPage = useNomadNetworkStore.getState().fetchNomadPage;
    await useNomadPageViewerStore.getState().loadPage('abc1234567890', '/page/index.mu');
    expect(fetchNomadPage).toHaveBeenCalledTimes(1);
    expect(nomadPageCacheSizeForTests()).toBe(1);
    expect(getNomadPageCache({ hash: 'abc1234567890', path: '/page/index.mu' })?.content).toBe(
      'hello',
    );

    await useNomadPageViewerStore.getState().loadPage('abc1234567890', '/page/index.mu');
    expect(fetchNomadPage).toHaveBeenCalledTimes(1);
    expect(useNomadPageViewerStore.getState().pageContent).toBe('hello');
  });

  it('updates countdown budget from sidecar egress on uncached RF responses', async () => {
    vi.useFakeTimers();
    const { restore } = mockConsoleWarn();
    try {
      const fetchNomadPage = vi.fn().mockResolvedValue({
        ok: false,
        error: 'link_timeout',
        egress: 'rf',
        timeout_secs: 99,
      });
      useNomadNetworkStore.setState({ fetchNomadPage });

      const loadPromise = useNomadPageViewerStore
        .getState()
        .loadPage('abc1234567890', '/page/index.mu');
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_DEBOUNCE_MS);
      await loadPromise;

      expect(fetchNomadPage).toHaveBeenCalledTimes(1);
      expect(useNomadPageViewerStore.getState().pageLoadingBudgetSec).toBe(99);
      expect(useNomadPageViewerStore.getState().pageErrorRaw).toBe('link_timeout');
      expect(useNomadPageViewerStore.getState().pageErrorEgress).toBe('rf');
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it('auto-retries TCP link_timeout once with forcePathRefresh', async () => {
    vi.useFakeTimers();
    const { restore } = mockConsoleWarn();
    try {
      const fetchNomadPage = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          error: 'link_timeout',
          egress: 'tcp',
        })
        .mockResolvedValueOnce({
          ok: true,
          content: 'hello after tcp retry',
          content_type: 'micron',
          egress: 'tcp',
        });
      useNomadNetworkStore.setState({ fetchNomadPage });

      const loadPromise = useNomadPageViewerStore
        .getState()
        .loadPage('abc1234567890', '/page/index.mu');
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_DEBOUNCE_MS);
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_RETRY_SETTLE_MS);
      await loadPromise;

      expect(fetchNomadPage).toHaveBeenCalledTimes(2);
      expect(fetchNomadPage).toHaveBeenNthCalledWith(
        2,
        'abc1234567890',
        '/page/index.mu',
        undefined,
        { forcePathRefresh: true },
      );
      expect(useNomadPageViewerStore.getState().pageContent).toBe('hello after tcp retry');
      expect(useNomadPageViewerStore.getState().pageErrorEgress).toBeNull();
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it('snapshots the node on unexpected fetch rejection', async () => {
    vi.useFakeTimers();
    const { restore } = mockConsoleWarn();
    try {
      const fetchNomadPage = vi.fn().mockRejectedValue(new Error('boom'));
      useNomadNetworkStore.setState({ fetchNomadPage });

      const loadPromise = useNomadPageViewerStore
        .getState()
        .loadPage('abc1234567890', '/page/index.mu');
      await vi.advanceTimersByTimeAsync(300);
      await loadPromise;

      const state = useNomadPageViewerStore.getState();
      expect(state.pageErrorRaw).toBe('unknown');
      expect(state.pageErrorNodeSnapshot).toEqual({
        hash: 'abc1234567890',
        lastSeen: 1,
        hops: 1,
      });
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it('setInvalidUrlError stores the raw invalid_url code', () => {
    useNomadPageViewerStore.getState().setInvalidUrlError();
    const state = useNomadPageViewerStore.getState();
    expect(state.pageErrorRaw).toBe('invalid_url');
    expect(state.pageErrorNodeSnapshot).toBeNull();
    expect(state.pageLoading).toBe(false);
    expect(state.pageLoadingStartedAt).toBeNull();
  });
});
