import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearNomadPageCache,
  clearNomadPageCacheForHash,
  getNomadPageCache,
  getNomadPageCacheGeneration,
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
    for (let i = 0; i < 129; i++) {
      const hash = `${i}`.padStart(32, 'a');
      setNomadPageCache({ hash, path: `/page/${i}.mu` }, { content: `page-${i}` });
    }
    expect(nomadPageCacheSizeForTests()).toBe(128);
    expect(getNomadPageCache({ hash: `0`.padStart(32, 'a'), path: '/page/0.mu' })).toBeUndefined();
    expect(
      getNomadPageCache({ hash: `128`.padStart(32, 'a'), path: '/page/128.mu' })?.content,
    ).toBe('page-128');
  });

  it('keeps anonymous and identified pages apart', () => {
    const hash = 'abc1234567890abcdef1234567890ab';
    const path = '/page/index.mu';
    setNomadPageCache({ hash, path, identify: false }, { content: 'anon' });
    setNomadPageCache({ hash, path, identify: true }, { content: 'named' });
    expect(getNomadPageCache({ hash, path, identify: false })?.content).toBe('anon');
    expect(getNomadPageCache({ hash, path, identify: true })?.content).toBe('named');
    expect(getNomadPageCache({ hash, path })?.content).toBe('anon');
  });

  it('bumps generation when one node is cleared so in-flight writers can drop', () => {
    const hash = 'abc1234567890abcdef1234567890ab';
    setNomadPageCache({ hash, path: '/page/index.mu', identify: true }, { content: 'named' });
    const before = getNomadPageCacheGeneration();
    clearNomadPageCacheForHash(hash.toUpperCase());
    expect(getNomadPageCacheGeneration()).toBe(before + 1);
    expect(nomadPageCacheSizeForTests()).toBe(0);
  });

  it('clears every page for one node only', () => {
    const a = 'abc1234567890abcdef1234567890abc';
    const b = 'def1234567890abcdef1234567890def';
    setNomadPageCache({ hash: a, path: '/page/index.mu' }, { content: 'a1' });
    setNomadPageCache(
      { hash: a, path: '/page/t.mu', requestData: { var_x: '1' } },
      { content: 'a2' },
    );
    setNomadPageCache({ hash: b, path: '/page/index.mu' }, { content: 'b1' });
    clearNomadPageCacheForHash(a.toUpperCase());
    expect(nomadPageCacheSizeForTests()).toBe(1);
    expect(getNomadPageCache({ hash: b, path: '/page/index.mu' })?.content).toBe('b1');
  });
});
