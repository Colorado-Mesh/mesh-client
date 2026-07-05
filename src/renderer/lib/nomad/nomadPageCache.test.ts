import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearNomadPageCache,
  getNomadPageCache,
  nomadPageCacheSizeForTests,
  setNomadPageCache,
} from './nomadPageCache';

describe('nomadPageCache', () => {
  beforeEach(() => {
    clearNomadPageCache();
  });

  it('stores and retrieves cached pages by hash and path', () => {
    setNomadPageCache(
      { hash: 'abc1234567890abcdef1234567890ab', path: '/page/index.mu' },
      { content: 'cached body', content_type: 'micron' },
    );
    const hit = getNomadPageCache({
      hash: 'abc1234567890abcdef1234567890ab',
      path: '/page/index.mu',
    });
    expect(hit?.content).toBe('cached body');
    expect(hit?.content_type).toBe('micron');
  });

  it('evicts oldest entries when over capacity', () => {
    for (let i = 0; i < 33; i++) {
      const hash = `${i}`.padStart(32, 'a');
      setNomadPageCache({ hash, path: `/page/${i}.mu` }, { content: `page-${i}` });
    }
    expect(nomadPageCacheSizeForTests()).toBe(32);
    expect(getNomadPageCache({ hash: `0`.padStart(32, 'a'), path: '/page/0.mu' })).toBeUndefined();
    expect(getNomadPageCache({ hash: `32`.padStart(32, 'a'), path: '/page/32.mu' })?.content).toBe(
      'page-32',
    );
  });
});
