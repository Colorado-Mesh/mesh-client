import { useSyncExternalStore } from 'react';

import { getDbHydrationRevision, subscribeDbHydrationRevision } from '../lib/dbHydrationRevision';

/** Re-renders when SQLite→store hydration completes successfully. */
export function useDbHydrationRevision(): number {
  return useSyncExternalStore(subscribeDbHydrationRevision, getDbHydrationRevision, () => 0);
}
