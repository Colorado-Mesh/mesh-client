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

  it('treats different requestData as distinct cache entries', () => {
    const hash = 'abc1234567890abcdef1234567890ab';
    const path = '/page/forum/thread.mu';
    setNomadPageCache({ hash, path, requestData: { var_thread_id: 'a' } }, { content: 'thread-a' });
    setNomadPageCache({ hash, path, requestData: { var_thread_id: 'b' } }, { content: 'thread-b' });
    expect(getNomadPageCache({ hash, path, requestData: { var_thread_id: 'a' } })?.content).toBe(
      'thread-a',
    );
    expect(getNomadPageCache({ hash, path, requestData: { var_thread_id: 'b' } })?.content).toBe(
      'thread-b',
    );
    expect(getNomadPageCache({ hash, path })?.content).toBeUndefined();
  });

  it('hits cache when requestData matches regardless of key order', () => {
    const hash = 'abc1234567890abcdef1234567890ab';
    const path = '/page/forum/thread.mu';
    setNomadPageCache({ hash, path, requestData: { var_b: '2', var_a: '1' } }, { content: 'same' });
    expect(
      getNomadPageCache({ hash, path, requestData: { var_a: '1', var_b: '2' } })?.content,
    ).toBe('same');
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
