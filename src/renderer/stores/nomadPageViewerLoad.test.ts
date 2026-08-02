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

  it('does not auto-retry when loadPage already requested forcePathRefresh', async () => {
    vi.useFakeTimers();
    const { restore } = mockConsoleWarn();
    try {
      const fetchNomadPage = vi.fn().mockResolvedValue({
        ok: false,
        error: 'link_timeout',
        egress: 'tcp',
        link_hops: 5,
        proof_budget_secs: 30,
      });
      useNomadNetworkStore.setState({ fetchNomadPage });

      // Caller already forced (announce reload / manual ↻) — skip debounce.
      const loadPromise = useNomadPageViewerStore
        .getState()
        .loadPage('abc1234567890', '/page/index.mu', { forcePathRefresh: true });
      await loadPromise;

      expect(fetchNomadPage).toHaveBeenCalledTimes(1);
      expect(fetchNomadPage).toHaveBeenCalledWith(
        'abc1234567890',
        '/page/index.mu',
        undefined,
        expect.objectContaining({ forcePathRefresh: true, requestId: expect.any(String) }),
      );
      expect(useNomadPageViewerStore.getState().pageErrorRaw).toBe('link_timeout');
      expect(useNomadPageViewerStore.getState().pageLoadingRetrying).toBe(false);
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it('auto-retries TCP link_timeout once with forcePathRefresh', async () => {
    vi.useFakeTimers();
    const { restore } = mockConsoleWarn();
    try {
      let resolveFirst: ((value: unknown) => void) | undefined;
      let resolveSecond: ((value: unknown) => void) | undefined;
      const firstFetch = new Promise((resolve) => {
        resolveFirst = resolve;
      });
      const secondFetch = new Promise((resolve) => {
        resolveSecond = resolve;
      });
      const fetchNomadPage = vi
        .fn()
        .mockImplementationOnce(() => firstFetch)
        .mockImplementationOnce(() => secondFetch);
      useNomadNetworkStore.setState({ fetchNomadPage });

      const loadPromise = useNomadPageViewerStore
        .getState()
        .loadPage('abc1234567890', '/page/index.mu');
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_DEBOUNCE_MS);
      const firstStartedAt = useNomadPageViewerStore.getState().pageLoadingStartedAt;
      expect(firstStartedAt).toBeTypeOf('number');

      resolveFirst?.({
        ok: false,
        error: 'link_timeout',
        egress: 'tcp',
        link_hops: 5,
        proof_budget_secs: 30,
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_RETRY_SETTLE_MS);
      const retryStartedAt = useNomadPageViewerStore.getState().pageLoadingStartedAt;
      expect(retryStartedAt).toBeTypeOf('number');
      expect(retryStartedAt).toBeGreaterThan(firstStartedAt!);
      // Retry countdown = 4s path refresh + sidecar-reported proof_budget_secs.
      expect(useNomadPageViewerStore.getState().pageLoadingBudgetSec).toBe(4 + 30);
      expect(useNomadPageViewerStore.getState().pageLoadingRetrying).toBe(true);

      resolveSecond?.({
        ok: true,
        content: 'hello after tcp retry',
        content_type: 'micron',
        egress: 'tcp',
      });
      await loadPromise;

      expect(fetchNomadPage).toHaveBeenCalledTimes(2);
      expect(fetchNomadPage).toHaveBeenNthCalledWith(
        2,
        'abc1234567890',
        '/page/index.mu',
        undefined,
        expect.objectContaining({ forcePathRefresh: true, requestId: expect.any(String) }),
      );
      expect(useNomadPageViewerStore.getState().pageContent).toBe('hello after tcp retry');
      expect(useNomadPageViewerStore.getState().pageErrorEgress).toBeNull();
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it('does not auto-retry TCP link_timeout after sidecar via failover rediscovered', async () => {
    vi.useFakeTimers();
    const { restore } = mockConsoleWarn();
    try {
      const fetchNomadPage = vi.fn().mockResolvedValue({
        ok: false,
        error: 'link_timeout',
        egress: 'tcp',
        force_path_ok: true,
        path_ensure_kind: 'rediscovered',
        tried_interfaces: ['Ratspeak', 'RNS_Transport_US-East'],
        link_hops: 7,
        proof_budget_secs: 45,
      });
      useNomadNetworkStore.setState({ fetchNomadPage });

      const loadPromise = useNomadPageViewerStore
        .getState()
        .loadPage('e7d84cefc1f9a8f9a80336f3fa2d2309', '/page/index.mu');
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_DEBOUNCE_MS);
      await loadPromise;
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_RETRY_SETTLE_MS);

      expect(fetchNomadPage).toHaveBeenCalledTimes(1);
      expect(useNomadPageViewerStore.getState().pageLoadingRetrying).toBe(false);
      expect(useNomadPageViewerStore.getState().pageErrorRaw).toBe('link_timeout');
      expect(useNomadPageViewerStore.getState().pageErrorDiag?.triedInterfaces).toEqual([
        'Ratspeak',
        'RNS_Transport_US-East',
      ]);
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it('retry budget uses link_hops when proof_budget_secs is absent', async () => {
    vi.useFakeTimers();
    const { restore } = mockConsoleWarn();
    try {
      let resolveFirst: ((value: unknown) => void) | undefined;
      let resolveSecond: ((value: unknown) => void) | undefined;
      const fetchNomadPage = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            }),
        );
      useNomadNetworkStore.setState({ fetchNomadPage });

      const loadPromise = useNomadPageViewerStore
        .getState()
        .loadPage('abc1234567890', '/page/index.mu');
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_DEBOUNCE_MS);
      const firstStartedAt = useNomadPageViewerStore.getState().pageLoadingStartedAt;
      expect(firstStartedAt).toBeTypeOf('number');

      resolveFirst?.({
        ok: false,
        error: 'link_timeout',
        egress: 'tcp',
        link_hops: 5,
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_RETRY_SETTLE_MS);
      const retryStartedAt = useNomadPageViewerStore.getState().pageLoadingStartedAt;
      expect(retryStartedAt).toBeTypeOf('number');
      expect(retryStartedAt).toBeGreaterThan(firstStartedAt!);
      // 4s path refresh + link_hops × 6s proof.
      expect(useNomadPageViewerStore.getState().pageLoadingBudgetSec).toBe(4 + 5 * 6);
      expect(useNomadPageViewerStore.getState().pageLoadingRetrying).toBe(true);

      resolveSecond?.({
        ok: true,
        content: 'ok via link_hops budget',
        content_type: 'micron',
        egress: 'tcp',
      });
      await loadPromise;
      expect(fetchNomadPage).toHaveBeenCalledTimes(2);
      expect(useNomadPageViewerStore.getState().pageContent).toBe('ok via link_hops budget');
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it('retry budget falls back to local clamp for path_timeout without link fields', async () => {
    vi.useFakeTimers();
    const { restore } = mockConsoleWarn();
    try {
      let resolveFirst: ((value: unknown) => void) | undefined;
      let resolveSecond: ((value: unknown) => void) | undefined;
      const fetchNomadPage = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            }),
        );
      useNomadNetworkStore.setState({ fetchNomadPage });

      const loadPromise = useNomadPageViewerStore
        .getState()
        .loadPage('abc1234567890', '/page/index.mu');
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_DEBOUNCE_MS);
      const firstStartedAt = useNomadPageViewerStore.getState().pageLoadingStartedAt;
      expect(firstStartedAt).toBeTypeOf('number');

      resolveFirst?.({
        ok: false,
        error: 'path_timeout',
        egress: 'tcp',
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_RETRY_SETTLE_MS);
      const retryStartedAt = useNomadPageViewerStore.getState().pageLoadingStartedAt;
      expect(retryStartedAt).toBeTypeOf('number');
      expect(retryStartedAt).toBeGreaterThan(firstStartedAt!);
      // Node hops=1 → TCP clamp floor 3 → 4 + 3×6.
      expect(useNomadPageViewerStore.getState().pageLoadingBudgetSec).toBe(4 + 3 * 6);
      expect(useNomadPageViewerStore.getState().pageLoadingRetrying).toBe(true);

      resolveSecond?.({
        ok: true,
        content: 'ok via path_timeout fallback',
        content_type: 'micron',
        egress: 'tcp',
      });
      await loadPromise;
      expect(fetchNomadPage).toHaveBeenCalledTimes(2);
      expect(useNomadPageViewerStore.getState().pageContent).toBe('ok via path_timeout fallback');
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
    useNomadPageViewerStore.setState({
      pageLoadingRetrying: true,
      pageLoadingBudgetSec: 42,
      pageLoading: true,
      pageLoadingStartedAt: Date.now(),
    });
    useNomadPageViewerStore.getState().setInvalidUrlError();
    const state = useNomadPageViewerStore.getState();
    expect(state.pageErrorRaw).toBe('invalid_url');
    expect(state.pageErrorNodeSnapshot).toBeNull();
    expect(state.pageLoading).toBe(false);
    expect(state.pageLoadingStartedAt).toBeNull();
    expect(state.pageLoadingRetrying).toBe(false);
    expect(state.pageLoadingBudgetSec).toBe(0);
  });

  it('starts a distinct fetch when a second load has a different requestId', async () => {
    vi.useFakeTimers();
    const hash = 'e7d84cefc1f9a8f9a80336f3fa2d2309';
    const path = '/page/index.mu';
    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    const fetchNomadPage = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    useNomadNetworkStore.setState({
      nodes: new Map([
        [
          hash,
          {
            destination_hash: hash,
            display_name: 'N',
            favorited: false,
            last_seen: 1,
            hops: 1,
          },
        ],
      ]),
      fetchNomadPage,
    });

    const firstLoad = useNomadPageViewerStore
      .getState()
      .loadPage(hash, path, { forceReload: true });
    await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_DEBOUNCE_MS);
    const firstRequestId = useNomadPageViewerStore.getState().pageProgressRequestId;
    expect(firstRequestId).toBeTruthy();
    expect(fetchNomadPage).toHaveBeenCalledTimes(1);

    const secondLoad = useNomadPageViewerStore
      .getState()
      .loadPage(hash, path, { forceReload: true });
    await vi.advanceTimersByTimeAsync(NOMAD_PAGE_FETCH_DEBOUNCE_MS);
    const secondRequestId = useNomadPageViewerStore.getState().pageProgressRequestId;
    expect(secondRequestId).toBeTruthy();
    expect(secondRequestId).not.toBe(firstRequestId);
    // Different requestId must not reuse the first in-flight promise.
    expect(fetchNomadPage).toHaveBeenCalledTimes(2);
    expect(fetchNomadPage).toHaveBeenNthCalledWith(
      1,
      hash,
      path,
      undefined,
      expect.objectContaining({ requestId: firstRequestId }),
    );
    expect(fetchNomadPage).toHaveBeenNthCalledWith(
      2,
      hash,
      path,
      undefined,
      expect.objectContaining({ requestId: secondRequestId }),
    );

    resolveFirst?.({ ok: false, error: 'link_timeout', egress: 'tcp' });
    resolveSecond?.({ ok: true, content: 'second wins', content_type: 'micron' });
    await Promise.all([firstLoad, secondLoad]);
    expect(useNomadPageViewerStore.getState().pageContent).toBe('second wins');
    vi.useRealTimers();
  });

  it('ignores late page_progress from a prior load of the same hash/path', () => {
    const hash = 'e7d84cefc1f9a8f9a80336f3fa2d2309';
    const path = '/page/index.mu';
    // Active load owns request_id "2"; late events from load "1" must not apply.
    useNomadPageViewerStore.setState({
      selectedHash: hash,
      pagePath: path,
      pageLoading: true,
      pageLoadingStartedAt: Date.now(),
      pageProgressRequestId: '2',
      pageLoadingProgress: null,
      pageLoadingTriedIfaces: [],
      pageLoadingBudgetSec: 45,
      loadGeneration: 2,
    });

    useNomadPageViewerStore.getState().applyPageProgress({
      destination_hash: hash,
      path,
      phase: 'failover',
      request_id: '1',
      iface: 'Ratspeak',
      hops: 4,
      timeout_secs: 45,
    });
    expect(useNomadPageViewerStore.getState().pageLoadingProgress).toBeNull();
    expect(useNomadPageViewerStore.getState().pageLoadingTriedIfaces).toEqual([]);
    expect(useNomadPageViewerStore.getState().pageLoadingBudgetSec).toBe(45);

    useNomadPageViewerStore.getState().applyPageProgress({
      destination_hash: hash,
      path,
      phase: 'link_attempt',
      request_id: '2',
      iface: 'RNS_Transport_US-East',
      hops: 3,
    });
    expect(useNomadPageViewerStore.getState().pageLoadingProgress).toEqual({
      messageKey: 'nomadNetwork.pageProgressLinking',
      messageParams: { iface: 'RNS_Transport_US-East', hops: 3 },
    });
    expect(useNomadPageViewerStore.getState().pageLoadingTriedIfaces).toEqual([
      'RNS_Transport_US-East',
    ]);
  });
});
