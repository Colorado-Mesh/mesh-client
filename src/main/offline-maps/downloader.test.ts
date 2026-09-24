// @vitest-environment node
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OfflineMapsDownloader } from './downloader';
import { createTileCache } from './tile-cache';

vi.mock('electron', () => ({
  net: {
    isOnline: () => true,
    fetch: vi.fn(),
  },
}));

describe('OfflineMapsDownloader', () => {
  const roots: string[] = [];
  let online = true;

  afterEach(async () => {
    const { rmSync } = await import('fs');
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    online = true;
    vi.restoreAllMocks();
  });

  function makeDownloader(fetchImpl: typeof fetch) {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-dl-'));
    roots.push(root);
    const cache = createTileCache(root);
    const onProgress = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const downloader = new OfflineMapsDownloader({
      cache,
      getAppVersion: () => '1.0.0',
      isOnline: () => online,
      fetchImpl,
      concurrency: 2,
      onlineDebounceMs: 5,
      offlinePollMs: 5,
      onProgress,
      onDone,
      onError,
    });
    return { downloader, cache, onProgress, onDone, onError };
  }

  const tinyBounds = { north: 40.001, south: 40.0, east: -105.0, west: -105.001 };

  it('completes a small region download', async () => {
    const png = Buffer.from([1, 2, 3, 4]);
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(png, { status: 200 })));
    const { downloader, onDone } = makeDownloader(fetchImpl);
    const est = downloader.estimate({
      bounds: tinyBounds,
      minZoom: 14,
      maxZoom: 14,
      basemapId: 'osm',
    });
    expect(est.withinCaps).toBe(true);
    expect(est.tileCount).toBeGreaterThan(0);
    const jobId = downloader.start({
      bounds: tinyBounds,
      minZoom: 14,
      maxZoom: 14,
      basemapId: 'osm',
    });
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(onDone.mock.calls[0][0].jobId).toBe(jobId);
    expect(onDone.mock.calls[0][0].completed).toBeGreaterThan(0);
  });

  it('cancels an active job id', async () => {
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(new Response(Buffer.from([1]), { status: 200 }));
          }, 50);
        }),
    );
    const { downloader, onDone } = makeDownloader(fetchImpl);
    const jobId = downloader.start({
      bounds: tinyBounds,
      minZoom: 10,
      maxZoom: 12,
      basemapId: 'osm',
    });
    expect(downloader.cancel(jobId)).toBe(true);
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(onDone.mock.calls[0][0].cancelled).toBe(true);
  });

  it('pauses when offline mid-job and resumes after debounce', async () => {
    online = false;
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(Buffer.from([9]), { status: 200 })));
    const { downloader, onProgress, onDone } = makeDownloader(fetchImpl);
    downloader.start({
      bounds: tinyBounds,
      minZoom: 14,
      maxZoom: 14,
      basemapId: 'osm',
    });
    await vi.waitFor(() => {
      expect(onProgress.mock.calls.some((c) => (c[0] as { paused: boolean }).paused)).toBe(true);
    });
    online = true;
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('cancels an offline-paused job and reports cancelled onDone', async () => {
    online = false;
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(Buffer.from([1]), { status: 200 })));
    const { downloader, onProgress, onDone } = makeDownloader(fetchImpl);
    const jobId = downloader.start({
      bounds: tinyBounds,
      minZoom: 14,
      maxZoom: 14,
      basemapId: 'osm',
    });
    await vi.waitFor(() => {
      expect(onProgress.mock.calls.some((c) => (c[0] as { paused: boolean }).paused)).toBe(true);
    });
    expect(downloader.cancel(jobId)).toBe(true);
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(onDone.mock.calls[0][0]).toMatchObject({ jobId, cancelled: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
