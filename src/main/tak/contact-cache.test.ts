// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TAKContact, TAKContactsUpdate } from '../../shared/tak-types';
import { TAK_CONTACT_FLUSH_MS, TAK_CONTACT_PRUNE_MS, TakContactCache } from './contact-cache';

function contact(uid: string, overrides: Partial<TAKContact> = {}): TAKContact {
  const now = Date.now();
  return {
    uid,
    type: 'a-f-G-U-C',
    callsign: uid,
    lat: 39,
    lon: -105,
    source: 'local',
    receivedAt: now,
    staleAt: now + 60_000,
    ...overrides,
  };
}

describe('TakContactCache', () => {
  let cache: TakContactCache;
  let updates: TAKContactsUpdate[];

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new TakContactCache(3);
    updates = [];
    cache.on('update', (u: TAKContactsUpdate) => updates.push(u));
  });

  afterEach(() => {
    cache.dispose();
    vi.useRealTimers();
  });

  it('coalesces upserts into one throttled update, latest per uid', () => {
    cache.upsert(contact('A', { lat: 1 }));
    cache.upsert(contact('A', { lat: 2 }));
    cache.upsert(contact('B'));
    expect(updates).toHaveLength(0);
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.upserts.map((c) => [c.uid, c.lat])).toEqual([
      ['A', 2],
      ['B', 39],
    ]);
    expect(updates[0]?.removedUids).toEqual([]);
  });

  it('evicts the least recently heard contact past the cap', () => {
    for (const uid of ['A', 'B', 'C']) cache.upsert(contact(uid));
    cache.upsert(contact('A'));
    cache.upsert(contact('D'));
    expect(cache.snapshot().map((c) => c.uid)).toEqual(['C', 'A', 'D']);
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    expect(updates[0]?.removedUids).toEqual(['B']);
    expect(updates[0]?.upserts.map((c) => c.uid).sort()).toEqual(['A', 'C', 'D']);
  });

  it('prunes stale contacts on the prune interval and reports them as removed', () => {
    cache.upsert(contact('OLD', { staleAt: Date.now() + 1000 }));
    cache.upsert(contact('NEW', { staleAt: Date.now() + 10 * TAK_CONTACT_PRUNE_MS }));
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    updates.length = 0;
    vi.advanceTimersByTime(TAK_CONTACT_PRUNE_MS + TAK_CONTACT_FLUSH_MS);
    expect(updates).toEqual([{ upserts: [], removedUids: ['OLD'] }]);
    expect(cache.snapshot().map((c) => c.uid)).toEqual(['NEW']);
  });

  it('snapshot excludes contacts that have gone stale', () => {
    cache.upsert(contact('A', { staleAt: Date.now() + 10 }));
    vi.setSystemTime(Date.now() + 20);
    expect(cache.snapshot()).toEqual([]);
  });

  it('removes only contacts from one source', () => {
    cache.upsert(contact('L'));
    cache.upsert(contact('R', { source: 'remote' }));
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    updates.length = 0;
    cache.removeSource('remote');
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    expect(updates).toEqual([{ upserts: [], removedUids: ['R'] }]);
    expect(cache.snapshot().map((c) => c.uid)).toEqual(['L']);
  });

  it('falls back to the other source when the visible source is removed', () => {
    cache.upsert(contact('U', { source: 'local', lat: 1 }));
    vi.advanceTimersByTime(10);
    cache.upsert(contact('U', { source: 'remote', lat: 2 }));
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    updates.length = 0;

    cache.removeSource('remote');
    expect(cache.snapshot()).toMatchObject([{ uid: 'U', source: 'local', lat: 1 }]);
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    expect(updates).toEqual([
      { upserts: [expect.objectContaining({ uid: 'U', source: 'local' })], removedUids: [] },
    ]);

    cache.removeSource('local');
    expect(cache.snapshot()).toEqual([]);
  });

  it('keeps the visible contact when a hidden source is removed', () => {
    cache.upsert(contact('U', { source: 'remote' }));
    cache.upsert(contact('U', { source: 'local' }));
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    updates.length = 0;
    cache.removeSource('remote');
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    expect(updates).toEqual([]);
    expect(cache.snapshot()).toMatchObject([{ uid: 'U', source: 'local' }]);
  });

  it('falls back to a fresher source when the visible contact goes stale', () => {
    cache.upsert(
      contact('U', { source: 'local', staleAt: Date.now() + 10 * TAK_CONTACT_PRUNE_MS }),
    );
    cache.upsert(contact('U', { source: 'remote', staleAt: Date.now() + 1000 }));
    vi.setSystemTime(Date.now() + 2000);
    expect(cache.snapshot()).toMatchObject([{ uid: 'U', source: 'local' }]);
  });

  it('drops a pending upsert when the contact is removed before the flush', () => {
    cache.upsert(contact('R', { source: 'remote' }));
    cache.removeSource('remote');
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    expect(updates).toEqual([{ upserts: [], removedUids: ['R'] }]);
  });
});
