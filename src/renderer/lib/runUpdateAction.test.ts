import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { UpdateState } from '@/renderer/App';
import { runUpdateAction, updateStateWithActionError } from '@/renderer/lib/runUpdateAction';

describe('runUpdateAction', () => {
  const baseState: UpdateState = {
    phase: 'ready',
    version: '9.9.9',
    isPackaged: true,
    isMac: false,
  };

  it('transitions update state to error when install rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let state = baseState;
    const setUpdateState: Dispatch<SetStateAction<UpdateState>> = (updater) => {
      state = typeof updater === 'function' ? updater(state) : updater;
    };

    runUpdateAction(
      () => Promise.reject(new Error('quit blocked')),
      setUpdateState,
      'update install',
    );

    await vi.waitFor(() => {
      expect(state.phase).toBe('error');
    });
    expect(state.errorMessage).toBe('quit blocked');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('maps rejected errors through updateStateWithActionError', () => {
    expect(updateStateWithActionError(baseState, new Error('download failed'))).toEqual({
      ...baseState,
      phase: 'error',
      errorMessage: 'download failed',
    });
  });
});
