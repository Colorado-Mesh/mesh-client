import { describe, expect, it, vi } from 'vitest';

import {
  RETICULUM_PEER_REFRESH_COALESCE_MS,
  reticulumSidecarEventRefreshActions,
  scheduleLeadingTrailingRefresh,
} from './reticulumSidecarPeerRefreshEvents';

describe('reticulumSidecarEventRefreshActions', () => {
  it('schedules peer + diagnostics refresh for peer-relevant events', () => {
    for (const type of ['announce.received', 'peers_updated', 'stack_restart_requested'] as const) {
      expect(reticulumSidecarEventRefreshActions(type)).toEqual({
        peers: true,
        diagnostics: true,
        interfaces: false,
      });
    }
  });

  it('does not reload the path table on stats_update', () => {
    expect(reticulumSidecarEventRefreshActions('stats_update')).toEqual({
      peers: false,
      diagnostics: true,
      interfaces: false,
    });
  });

  it('only refreshes interfaces on interface.state', () => {
    expect(reticulumSidecarEventRefreshActions('interface.state')).toEqual({
      peers: false,
      diagnostics: false,
      interfaces: true,
    });
  });

  it('ignores unrelated event types', () => {
    expect(reticulumSidecarEventRefreshActions('lxmf_message')).toEqual({
      peers: false,
      diagnostics: false,
      interfaces: false,
    });
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
