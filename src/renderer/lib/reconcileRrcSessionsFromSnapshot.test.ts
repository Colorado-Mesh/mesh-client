import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reconcileRrcHubAfterDeadSend,
  reconcileRrcSessionsFromSnapshot,
  scheduleRrcSessionStatusReconcile,
} from '@/renderer/lib/reconcileRrcSessionsFromSnapshot';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import type { RrcMultiSessionSnapshot } from '@/shared/rrc-types';

const HUB_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HUB_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function snap(sessions: RrcMultiSessionSnapshot['sessions']): RrcMultiSessionSnapshot {
  return { sessions, identity_hash: 'cccccccccccccccccccccccccccccccc' };
}

function deferredStatus(): {
  promise: Promise<RrcMultiSessionSnapshot>;
  resolve: (value: RrcMultiSessionSnapshot) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: RrcMultiSessionSnapshot) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<RrcMultiSessionSnapshot>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('reconcileRrcSessionsFromSnapshot', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
  });

  it('clears a UI-active hub missing from the sidecar snapshot', () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_A)?.status).toBe('active');

    reconcileRrcSessionsFromSnapshot(snap([]));

    expect(useRrcSessionStore.getState().sessionsByHub.has(HUB_A)).toBe(false);
  });

  it('demotes UI-active to reconnecting when sidecar is reconnecting', () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');

    reconcileRrcSessionsFromSnapshot(
      snap([
        {
          status: 'reconnecting',
          hub_dest_hash: HUB_A,
          hub_name: 'Hub A',
          rooms: [],
          error: 'timeout',
        },
      ]),
    );

    const ui = useRrcSessionStore.getState().sessionsByHub.get(HUB_A);
    expect(ui?.status).toBe('reconnecting');
    expect(ui?.lastError).toBe('timeout');
  });

  it('leaves an already-active matching hub alone', () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');

    reconcileRrcSessionsFromSnapshot(
      snap([
        {
          status: 'active',
          hub_dest_hash: HUB_A,
          hub_name: 'Hub A',
          rooms: [],
        },
      ]),
    );

    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_A)?.status).toBe('active');
  });

  it('does not demote when disconnectIntent is set', () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    useRrcSessionStore.getState().setDisconnectIntent(true, HUB_A);

    reconcileRrcSessionsFromSnapshot(snap([]));

    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_A)?.status).toBe('active');
  });

  it('only reconciles the requested hub when hubDestHash is set', () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    useRrcSessionStore.getState().applyStatus('active', HUB_B, 'Hub B');

    reconcileRrcSessionsFromSnapshot(snap([]), { hubDestHash: HUB_A });

    expect(useRrcSessionStore.getState().sessionsByHub.has(HUB_A)).toBe(false);
    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_B)?.status).toBe('active');
  });

  it('skips hubs whose expected generation is stale', () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    const gen = useRrcSessionStore.getState().sessionsByHub.get(HUB_A)!.generation;
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');

    reconcileRrcSessionsFromSnapshot(snap([]), {
      hubDestHash: HUB_A,
      expectedGenerations: new Map([[HUB_A, gen]]),
    });

    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_A)?.status).toBe('active');
  });
});

describe('reconcileRrcHubAfterDeadSend', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
  });

  it('forces reconnecting when snapshot still claims active', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    const getStatus = vi.fn().mockResolvedValue(
      snap([
        {
          status: 'active',
          hub_dest_hash: HUB_A,
          hub_name: 'Hub A',
          rooms: [],
        },
      ]),
    );

    await reconcileRrcHubAfterDeadSend(HUB_A, getStatus);

    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_A)?.status).toBe('reconnecting');
  });

  it('clears the hub when sidecar snapshot has no session', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    const getStatus = vi.fn().mockResolvedValue(snap([]));

    await reconcileRrcHubAfterDeadSend(HUB_A, getStatus);

    expect(useRrcSessionStore.getState().sessionsByHub.has(HUB_A)).toBe(false);
  });

  it('demotes to reconnecting when getStatus throws', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    const getStatus = vi.fn().mockRejectedValue(new Error('down'));

    await reconcileRrcHubAfterDeadSend(HUB_A, getStatus);

    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_A)?.status).toBe('reconnecting');
  });

  it('does not clear when a newer connect bumps generation before getStatus returns', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    const delayed = deferredStatus();
    const getStatus = vi.fn().mockReturnValue(delayed.promise);

    const pending = reconcileRrcHubAfterDeadSend(HUB_A, getStatus);
    // Newer connect event while status fetch is in flight.
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    delayed.resolve(snap([]));
    await pending;

    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_A)?.status).toBe('active');
  });

  it('does not force reconnecting when generation advances before getStatus fails', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    const delayed = deferredStatus();
    const getStatus = vi.fn().mockReturnValue(delayed.promise);

    const pending = reconcileRrcHubAfterDeadSend(HUB_A, getStatus);
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    delayed.reject(new Error('down'));
    await pending;

    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_A)?.status).toBe('active');
  });
});

describe('scheduleRrcSessionStatusReconcile', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
  });

  it('clears stale hubs when generations are unchanged', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    useRrcSessionStore.getState().applyStatus('active', HUB_B, 'Hub B');
    const getStatus = vi.fn().mockResolvedValue(snap([]));

    await scheduleRrcSessionStatusReconcile('test', getStatus);

    expect(useRrcSessionStore.getState().sessionsByHub.has(HUB_A)).toBe(false);
    expect(useRrcSessionStore.getState().sessionsByHub.has(HUB_B)).toBe(false);
  });

  it('does not clear a hub whose generation advanced while getStatus was delayed', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    useRrcSessionStore.getState().applyStatus('active', HUB_B, 'Hub B');
    const delayed = deferredStatus();
    const getStatus = vi.fn().mockReturnValue(delayed.promise);

    const pending = scheduleRrcSessionStatusReconcile('ws_lag', getStatus);
    // Hub A reconnects; hub B stays at the captured generation.
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    delayed.resolve(snap([]));
    await pending;

    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_A)?.status).toBe('active');
    expect(useRrcSessionStore.getState().sessionsByHub.has(HUB_B)).toBe(false);
  });

  it('does not demote to reconnecting when generation advanced before delayed snapshot', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    const delayed = deferredStatus();
    const getStatus = vi.fn().mockReturnValue(delayed.promise);

    const pending = scheduleRrcSessionStatusReconcile('ws_reconnect', getStatus);
    useRrcSessionStore.getState().applyStatus('active', HUB_A, 'Hub A');
    delayed.resolve(
      snap([
        {
          status: 'reconnecting',
          hub_dest_hash: HUB_A,
          hub_name: 'Hub A',
          rooms: [],
        },
      ]),
    );
    await pending;

    expect(useRrcSessionStore.getState().sessionsByHub.get(HUB_A)?.status).toBe('active');
  });
});
