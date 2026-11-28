import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { IdentityId } from '@/renderer/lib/types';
import type { ReachCheckApi, ReachCheckResult, ReachCheckSession } from '@/shared/reachCheck';

import {
  REACH_CHECK_POLL_INTERVAL_MS,
  REACH_CHECK_POLL_MAX_MS,
  startReachCheckPolling,
  stopAllReachCheckPolling,
} from './reachCheckPoller';
import { type ReachCheckEntry, useReachCheckStore } from './reachCheckStore';

const A = 'meshcore:aa' as IdentityId;
const B = 'meshcore:bb' as IdentityId;
const T0 = 1_800_000_000_000;

function session(overrides: Partial<ReachCheckSession> = {}): ReachCheckSession {
  return {
    id: 's1',
    code: 'MHC-1A2B3C',
    status: 'active',
    expiresAt: T0 + 600_000,
    observedCount: 3,
    expectedCount: 10,
    repeaterCount: 2,
    distanceText: '12 mi',
    sharePath: '/share/s1',
    ...overrides,
  };
}

function startEntry(identityId: IdentityId, messageId: string, sessionId = 's1'): void {
  const entry: ReachCheckEntry = {
    origin: 'https://rangecheck.example.org',
    sessionId,
    code: 'MHC-1A2B3C',
    session: session({ id: sessionId, status: 'waiting', observedCount: 0 }),
    state: 'polling',
    startedAt: Date.now(),
  };
  useReachCheckStore.getState().start(identityId, messageId, entry);
}

function apiAnswering(...answers: (ReachCheckResult<ReachCheckSession> | Error)[]): {
  getSession: Mock<ReachCheckApi['getSession']>;
} {
  const getSession = vi.fn<ReachCheckApi['getSession']>((_origin, id) => {
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next === undefined) return Promise.resolve({ ok: false, error: 'network' });
    if (next instanceof Error) return Promise.reject(next);
    if (next.ok) return Promise.resolve({ ...next, value: { ...next.value, id } });
    return Promise.resolve(next);
  });
  return { getSession };
}

async function tick(ms = REACH_CHECK_POLL_INTERVAL_MS): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  useReachCheckStore.setState({ entries: {} });
});

afterEach(() => {
  stopAllReachCheckPolling();
  vi.useRealTimers();
});

describe('startReachCheckPolling', () => {
  it('polls every 4 s and stores the latest counts', async () => {
    const api = apiAnswering({ ok: true, value: session() });
    startEntry(A, 'out:1');
    startReachCheckPolling('s1', { api });
    expect(api.getSession).not.toHaveBeenCalled();
    await tick();
    expect(api.getSession).toHaveBeenCalledTimes(1);
    expect(api.getSession).toHaveBeenCalledWith('https://rangecheck.example.org', 's1');
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')?.session?.observedCount).toBe(3);
    await tick();
    expect(api.getSession).toHaveBeenCalledTimes(2);
  });

  it.each(['exhausted', 'expired'] as const)('stops when the session is %s', async (status) => {
    const api = apiAnswering({ ok: true, value: session({ status }) });
    startEntry(A, 'out:1');
    startReachCheckPolling('s1', { api });
    await tick();
    await tick();
    await tick();
    expect(api.getSession).toHaveBeenCalledTimes(1);
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')?.state).toBe('finished');
  });

  it('makes one final fetch once the code has expired, then stops', async () => {
    const api = apiAnswering({ ok: true, value: session({ expiresAt: T0 + 6_000 }) });
    startEntry(A, 'out:1');
    startReachCheckPolling('s1', { api });
    await tick();
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')?.state).toBe('polling');
    await tick();
    expect(api.getSession).toHaveBeenCalledTimes(2);
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')?.state).toBe('finished');
    await tick();
    expect(api.getSession).toHaveBeenCalledTimes(2);
  });

  it('stops 15 minutes after start', async () => {
    const api = apiAnswering({ ok: true, value: session({ expiresAt: T0 + 1_800_000 }) });
    startEntry(A, 'out:1');
    startReachCheckPolling('s1', { api });
    await tick(REACH_CHECK_POLL_MAX_MS + REACH_CHECK_POLL_INTERVAL_MS);
    const calls = api.getSession.mock.calls.length;
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')?.state).toBe('finished');
    await tick(REACH_CHECK_POLL_INTERVAL_MS * 3);
    expect(api.getSession).toHaveBeenCalledTimes(calls);
  });

  it('marks results gone when the server forgot the session', async () => {
    const api = apiAnswering({ ok: false, error: 'session_not_found' });
    startEntry(A, 'out:1');
    startReachCheckPolling('s1', { api });
    await tick();
    await tick();
    expect(api.getSession).toHaveBeenCalledTimes(1);
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')?.state).toBe('gone');
  });

  it('keeps polling through a single network error', async () => {
    const api = apiAnswering(
      { ok: false, error: 'network' },
      { ok: true, value: session({ observedCount: 5 }) },
    );
    startEntry(A, 'out:1');
    startReachCheckPolling('s1', { api });
    await tick();
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')?.state).toBe('polling');
    await tick();
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')?.session?.observedCount).toBe(5);
  });

  it('gives up after three failures in a row', async () => {
    const api = apiAnswering(new Error('ipc gone'), { ok: false, error: 'network' });
    startEntry(A, 'out:1');
    startReachCheckPolling('s1', { api });
    await tick();
    await tick();
    await tick();
    expect(useReachCheckStore.getState().entryFor(A, 'out:1')).toMatchObject({
      state: 'error',
      error: 'network',
    });
    await tick();
    expect(api.getSession).toHaveBeenCalledTimes(3);
  });

  it('keeps polling after the message id is renamed', async () => {
    const api = apiAnswering({ ok: true, value: session({ observedCount: 6 }) });
    startEntry(A, 'out:1');
    startReachCheckPolling('s1', { api });
    useReachCheckStore.getState().renameMessage(A, 'out:1', '99');
    await tick();
    expect(api.getSession).toHaveBeenCalledTimes(1);
    expect(useReachCheckStore.getState().entryFor(A, '99')?.session?.observedCount).toBe(6);
  });

  it('stops polling for a cleared identity only', async () => {
    const api = apiAnswering({ ok: true, value: session() });
    startEntry(A, 'out:1', 's1');
    startEntry(B, 'out:2', 's2');
    startReachCheckPolling('s1', { api });
    startReachCheckPolling('s2', { api });
    useReachCheckStore.getState().clearIdentity(A);
    await tick();
    await tick();
    expect(api.getSession.mock.calls.map((call) => call[1])).toEqual(['s2', 's2']);
    expect(useReachCheckStore.getState().entryFor(B, 'out:2')?.state).toBe('polling');
  });

  it('does not start a second poller for the same session', async () => {
    const api = apiAnswering({ ok: true, value: session() });
    startEntry(A, 'out:1');
    startReachCheckPolling('s1', { api });
    startReachCheckPolling('s1', { api });
    await tick();
    expect(api.getSession).toHaveBeenCalledTimes(1);
  });
});
