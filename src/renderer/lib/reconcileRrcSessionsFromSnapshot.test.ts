import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reconcileRrcHubAfterDeadSend,
  reconcileRrcSessionsFromSnapshot,
} from '@/renderer/lib/reconcileRrcSessionsFromSnapshot';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import type { RrcMultiSessionSnapshot } from '@/shared/rrc-types';

const HUB_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HUB_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function snap(sessions: RrcMultiSessionSnapshot['sessions']): RrcMultiSessionSnapshot {
  return { sessions, identity_hash: 'cccccccccccccccccccccccccccccccc' };
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
});
