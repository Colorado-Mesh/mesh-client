import { describe, expect, it } from 'vitest';

import { reticulumSidecarEventRefreshActions } from './reticulumSidecarPeerRefreshEvents';

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
