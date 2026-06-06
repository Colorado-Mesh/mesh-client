import { useEffect } from 'react';

import { runStartupDbPrune } from '@/renderer/lib/startupDbPrune';

/** Run SQLite retention prune once per session, then invoke post-prune hydration. */
export function useAppStartupDbPrune(onAfterPrune: () => void): void {
  useEffect(() => {
    void runStartupDbPrune().then(onAfterPrune);
  }, [onAfterPrune]);
}
