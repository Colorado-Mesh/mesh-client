import { beforeEach, describe, expect, it } from 'vitest';

import type { TAKContact } from '@/shared/tak-types';

import { useTakContactStore } from './takContactStore';

function contact(uid: string, staleAt = 2000): TAKContact {
  return {
    uid,
    type: 'a-f-G-U-C',
    callsign: uid,
    lat: 1,
    lon: 2,
    source: 'remote',
    receivedAt: 1000,
    staleAt,
  };
}

describe('takContactStore', () => {
  beforeEach(() => {
    useTakContactStore.getState().replaceAll([]);
  });

  it('replaces the snapshot and applies batched upserts and removals', () => {
    const store = useTakContactStore.getState();
    store.replaceAll([contact('A'), contact('B')]);
    store.applyUpdate({
      upserts: [{ ...contact('A'), callsign: 'ALPHA' }, contact('C')],
      removedUids: ['B'],
    });
    const contacts = useTakContactStore.getState().contacts;
    expect([...contacts.keys()].sort()).toEqual(['A', 'C']);
    expect(contacts.get('A')?.callsign).toBe('ALPHA');
  });

  it('keeps the same map reference for an empty update', () => {
    const before = useTakContactStore.getState().contacts;
    useTakContactStore.getState().applyUpdate({ upserts: [], removedUids: [] });
    expect(useTakContactStore.getState().contacts).toBe(before);
  });

  it('prunes stale contacts and leaves the map untouched when none are stale', () => {
    const store = useTakContactStore.getState();
    store.replaceAll([contact('OLD', 1500), contact('NEW', 5000)]);
    const before = useTakContactStore.getState().contacts;
    store.pruneStale(1000);
    expect(useTakContactStore.getState().contacts).toBe(before);
    store.pruneStale(1500);
    expect([...useTakContactStore.getState().contacts.keys()]).toEqual(['NEW']);
  });
});
