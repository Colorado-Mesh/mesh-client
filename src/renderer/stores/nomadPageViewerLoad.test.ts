import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearNomadPageCache,
  getNomadPageCache,
  nomadPageCacheSizeForTests,
} from '@/renderer/lib/nomad/nomadPageCache';

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
});
