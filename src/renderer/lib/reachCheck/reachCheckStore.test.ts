import { beforeEach, describe, expect, it } from 'vitest';

import type { IdentityId } from '@/renderer/lib/types';

import {
  REACH_CHECK_SOFT_CAP,
  type ReachCheckEntry,
  reachCheckKey,
  useReachCheckStore,
} from './reachCheckStore';

const A = 'meshcore:aa' as IdentityId;
const B = 'meshcore:bb' as IdentityId;

function entry(overrides: Partial<ReachCheckEntry> = {}): ReachCheckEntry {
  return {
    origin: 'https://rangecheck.example.org',
    sessionId: 's1',
    code: 'MHC-1A2B3C',
    session: null,
    state: 'polling',
    startedAt: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  useReachCheckStore.setState({ entries: {} });
});

describe('reachCheckStore', () => {
  it('keys entries the same way as relay coverage', () => {
    expect(reachCheckKey(A, 'out:1')).toBe('meshcore:aa:out:1');
  });

  it('starts and reads an entry', () => {
    useReachCheckStore.getState().start(A, 'out:1', entry());
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')).toEqual(entry());
    expect(useReachCheckStore.getState().entryFor(B, 'out:1')).toBeUndefined();
  });

  it('patches an entry by key and ignores unknown keys', () => {
    useReachCheckStore.getState().start(A, 'out:1', entry());
    useReachCheckStore.getState().update(reachCheckKey(A, 'out:1'), { state: 'finished' });
    useReachCheckStore.getState().update('missing', { state: 'gone' });
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')?.state).toBe('finished');
    expect(Object.keys(useReachCheckStore.getState().entries)).toEqual([reachCheckKey(A, 'out:1')]);
  });

  it('moves an entry when its message id is renamed', () => {
    useReachCheckStore.getState().start(A, 'out:1', entry());
    useReachCheckStore.getState().renameMessage(A, 'out:1', '42');
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')).toBeUndefined();
    expect(useReachCheckStore.getState().entryFor(A, '42')?.sessionId).toBe('s1');
  });

  it('clears one identity only', () => {
    useReachCheckStore.getState().start(A, 'out:1', entry());
    useReachCheckStore.getState().start(B, 'out:2', entry({ sessionId: 's2' }));
    useReachCheckStore.getState().clearIdentity(A);
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')).toBeUndefined();
    expect(useReachCheckStore.getState().entryFor(B, 'out:2')?.sessionId).toBe('s2');
  });

  it('finds an entry key by session id', () => {
    useReachCheckStore.getState().start(A, 'out:1', entry({ sessionId: 'abc' }));
    expect(useReachCheckStore.getState().keyForSession('abc')).toBe(reachCheckKey(A, 'out:1'));
    expect(useReachCheckStore.getState().keyForSession('zzz')).toBeUndefined();
  });

  it('drops the oldest entries beyond the soft cap', () => {
    for (let i = 0; i <= REACH_CHECK_SOFT_CAP; i += 1) {
      useReachCheckStore
        .getState()
        .start(A, `out:${i}`, entry({ sessionId: `s${i}`, startedAt: 1000 + i }));
    }
    const keys = Object.keys(useReachCheckStore.getState().entries);
    expect(keys).toHaveLength(REACH_CHECK_SOFT_CAP);
    expect(useReachCheckStore.getState().entryFor(A, 'out:0')).toBeUndefined();
    expect(useReachCheckStore.getState().entryFor(A, `out:${REACH_CHECK_SOFT_CAP}`)).toBeDefined();
  });
});
