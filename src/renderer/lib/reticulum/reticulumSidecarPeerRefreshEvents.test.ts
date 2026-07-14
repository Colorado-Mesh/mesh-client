import { describe, expect, it, vi } from 'vitest';

import {
  peersUpdatedRequiresFullRefresh,
  RETICULUM_PEER_REFRESH_COALESCE_MS,
  RETICULUM_PEER_REFRESH_STORM_COALESCE_MS,
  reticulumSidecarEventRefreshActions,
  scheduleLeadingTrailingRefresh,
  scheduleTrailingOnlyRefresh,
} from './reticulumSidecarPeerRefreshEvents';

describe('reticulumSidecarEventRefreshActions', () => {
  it('uses incremental peer patches for announce and peers_updated', () => {
    for (const type of ['announce.received', 'peers_updated'] as const) {
      expect(reticulumSidecarEventRefreshActions(type)).toEqual({
        peers: false,
        diagnostics: true,
        interfaces: false,
        peerPatches: true,
      });
    }
  });

  it('schedules full peer refresh on stack restart', () => {
    expect(reticulumSidecarEventRefreshActions('stack_restart_requested')).toEqual({
      peers: true,
      diagnostics: true,
      interfaces: false,
      peerPatches: false,
    });
  });

  it('does not reload the path table on stats_update', () => {
    expect(reticulumSidecarEventRefreshActions('stats_update')).toEqual({
      peers: false,
      diagnostics: true,
      interfaces: false,
      peerPatches: false,
    });
  });

  it('only refreshes interfaces on interface.state', () => {
    expect(reticulumSidecarEventRefreshActions('interface.state')).toEqual({
      peers: false,
      diagnostics: false,
      interfaces: true,
      peerPatches: false,
    });
  });

  it('ignores unrelated event types', () => {
    expect(reticulumSidecarEventRefreshActions('lxmf_message')).toEqual({
      peers: false,
      diagnostics: false,
      interfaces: false,
      peerPatches: false,
    });
  });
});

describe('peersUpdatedRequiresFullRefresh', () => {
  it('returns false when patches are present', () => {
    expect(
      peersUpdatedRequiresFullRefresh({
        added: ['aa'],
        patches: [{ destination_hash: 'aa' }],
        count: 1,
      }),
    ).toBe(false);
  });

  it('returns false when only added hashes are present', () => {
    expect(peersUpdatedRequiresFullRefresh({ added: ['aa'], count: 1 })).toBe(false);
  });

  it('returns true for clear / demote / probe payloads', () => {
    expect(peersUpdatedRequiresFullRefresh({ cleared: true })).toBe(true);
    expect(peersUpdatedRequiresFullRefresh({ demoted_from_contacts: 3 })).toBe(true);
    expect(peersUpdatedRequiresFullRefresh({ hash: 'aabb' })).toBe(true);
  });
});

describe('scheduleLeadingTrailingRefresh', () => {
  it('runs leading refresh immediately then trailing after coalesce', () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    scheduleLeadingTrailingRefresh({ timerRef, onRefresh });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    scheduleLeadingTrailingRefresh({ timerRef, onRefresh });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(RETICULUM_PEER_REFRESH_COALESCE_MS);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(timerRef.current).toBeNull();

    vi.useRealTimers();
  });

  it('coalesces a burst into one trailing refresh after quiet', () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    scheduleLeadingTrailingRefresh({ timerRef, onRefresh });
    scheduleLeadingTrailingRefresh({ timerRef, onRefresh });
    vi.advanceTimersByTime(RETICULUM_PEER_REFRESH_COALESCE_MS / 2);
    scheduleLeadingTrailingRefresh({ timerRef, onRefresh });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(RETICULUM_PEER_REFRESH_COALESCE_MS);
    expect(onRefresh).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

describe('scheduleTrailingOnlyRefresh', () => {
  it('does not fire until coalesce elapses', () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    scheduleTrailingOnlyRefresh({ timerRef, onRefresh });
    expect(onRefresh).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(RETICULUM_PEER_REFRESH_STORM_COALESCE_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
