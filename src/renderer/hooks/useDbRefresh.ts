import { useCallback, useMemo } from 'react';

import { hydrateIdentityStoresFromDb } from '../lib/hydrateIdentityStoresFromDb';
import type { IdentityId, MeshProtocol } from '../lib/types';

/**
 * Re-pulls nodes and messages from SQLite into identity-scoped Zustand stores.
 * Requires `identityId` after connect (or from `identityStore` via `useActiveMeshIdentity`).
 */
export function useProtocolDbRefresh(protocol: MeshProtocol, identityId: IdentityId | null) {
  const refreshNodesFromDb = useCallback(async (): Promise<void> => {
    if (!identityId) return;
    await hydrateIdentityStoresFromDb(protocol, identityId, { nodes: true, messages: false });
  }, [protocol, identityId]);

  const refreshMessagesFromDb = useCallback(async (): Promise<void> => {
    if (!identityId) return;
    await hydrateIdentityStoresFromDb(protocol, identityId, { nodes: false, messages: true });
  }, [protocol, identityId]);

  const refreshAllFromDb = useCallback(async (): Promise<void> => {
    if (!identityId) return;
    await hydrateIdentityStoresFromDb(protocol, identityId, { nodes: true, messages: true });
  }, [protocol, identityId]);

  return useMemo(
    () => ({ refreshNodesFromDb, refreshMessagesFromDb, refreshAllFromDb }),
    [refreshNodesFromDb, refreshMessagesFromDb, refreshAllFromDb],
  );
}

/** @deprecated Prefer {@link useProtocolDbRefresh} with explicit protocol. */
export function useDbRefresh(identityId: IdentityId | null) {
  return useProtocolDbRefresh('meshtastic', identityId);
}
