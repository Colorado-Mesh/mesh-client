import type { Dispatch, SetStateAction } from 'react';

import type { UpdateState } from '@/renderer/App';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

export function updateStateWithActionError(prev: UpdateState, error: unknown): UpdateState {
  return {
    ...prev,
    phase: 'error',
    errorMessage: errLikeToLogString(error),
  };
}

export function runUpdateAction(
  action: () => Promise<void>,
  setUpdateState: Dispatch<SetStateAction<UpdateState>>,
  logLabel: string,
): void {
  void action().catch((e: unknown) => {
    console.warn(`[App] ${logLabel} failed ` + errLikeToLogString(e));
    setUpdateState((s) => updateStateWithActionError(s, e));
  });
}
