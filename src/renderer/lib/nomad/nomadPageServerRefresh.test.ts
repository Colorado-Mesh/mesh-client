import { describe, expect, it } from 'vitest';

import { planServingListsApply, planServingStatusApply } from './nomadPageServerRefresh';

describe('nomadPageServerRefresh', () => {
  it('plans sidecar-down when the stack is not running', () => {
    expect(planServingStatusApply({ ok: false, error: 'sidecar_not_running' }, false)).toEqual({
      kind: 'sidecar_down',
    });
  });

  it('plans status updates and preserves dirty display names', () => {
    const serving = { display_name: 'Home', last_error: null };
    expect(planServingStatusApply({ ok: true, serving }, false)).toEqual({
      kind: 'status',
      serving,
      displayName: 'Home',
      clearHostingErrorLog: true,
      statusError: undefined,
    });
    expect(planServingStatusApply({ ok: true, serving }, true)).toMatchObject({
      kind: 'status',
      displayName: undefined,
    });
    expect(
      planServingStatusApply(
        { ok: true, serving: { display_name: 'X', last_error: 'content_source_required' } },
        false,
      ),
    ).toMatchObject({
      kind: 'status',
      clearHostingErrorLog: false,
      statusError: 'content_source_required',
    });
  });

  it('plans list updates and surfaces list errors', () => {
    expect(
      planServingListsApply(
        { ok: true, serving: { last_error: null } },
        { ok: true, pages: [{ path: 'index.mu' }] },
        { ok: true, files: [] },
      ),
    ).toEqual({
      pages: [{ path: 'index.mu' }],
      files: [],
      clearError: true,
    });
    expect(
      planServingListsApply(
        { ok: true, serving: { last_error: 'watcher_init_failed' } },
        { ok: false, error: 'nomad_busy' },
        { ok: false, error: 'serving_files_unavailable' },
      ),
    ).toEqual({
      pagesError: 'nomad_busy',
      filesError: 'serving_files_unavailable',
    });
  });
});
