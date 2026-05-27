import { useCallback } from 'react';

/**
 * Re-pulls nodes from SQLite back into the in-memory node store. Called from
 * App.tsx startup pruning + "Reload from DB" admin buttons. Wired against the
 * existing electronAPI; the actual repopulation of `nodeStore` happens in the
 * ConnectionDriver's hydration path (TODO once startup hydration ships).
 */
export function useRefreshNodesFromDb() {
  return useCallback(async (): Promise<void> => {
    // No-op stub: the new architecture hydrates per-identity slices from DB
    // on identity creation; explicit refresh becomes obsolete. Kept as a hook
    // so App.tsx can call it without conditional logic during migration.
  }, []);
}

export function useRefreshMessagesFromDb() {
  return useCallback(async (): Promise<void> => {
    // See useRefreshNodesFromDb — DB hydration is identity-scoped in the new
    // architecture; this shim is kept for callsite compatibility.
  }, []);
}
