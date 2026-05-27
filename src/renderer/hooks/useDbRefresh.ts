import { useCallback, useMemo } from 'react';

import { chatMessageToMessageRecord, meshNodeToNodeRecord } from '../lib/storeRecordAdapters';
import type { IdentityId } from '../lib/types';
import { upsertMessage } from '../stores/messageStore';
import { upsertNode } from '../stores/nodeStore';

/**
 * Re-pulls Meshtastic nodes from SQLite into the identity-scoped node store.
 * Requires `identityId` from the Meshtastic runtime after connect.
 */
export function useRefreshNodesFromDb(identityId: IdentityId | null) {
  return useCallback(async (): Promise<void> => {
    if (!identityId) return;
    try {
      const rows = await window.electronAPI.db.getNodes();
      for (const row of rows) {
        upsertNode(identityId, meshNodeToNodeRecord(row));
      }
    } catch (e) {
      console.warn('[useRefreshNodesFromDb] failed', e);
    }
  }, [identityId]);
}

/**
 * Re-pulls Meshtastic messages from SQLite into the identity-scoped message store.
 */
export function useRefreshMessagesFromDb(identityId: IdentityId | null) {
  return useCallback(async (): Promise<void> => {
    if (!identityId) return;
    try {
      const rows = await window.electronAPI.db.getMessages(undefined, 10_000);
      for (const row of rows) {
        upsertMessage(identityId, chatMessageToMessageRecord(row));
      }
    } catch (e) {
      console.warn('[useRefreshMessagesFromDb] failed', e);
    }
  }, [identityId]);
}

/** Combined DB → store refresh helpers for App startup and prune callbacks. */
export function useDbRefresh(identityId: IdentityId | null) {
  const refreshNodesFromDb = useRefreshNodesFromDb(identityId);
  const refreshMessagesFromDb = useRefreshMessagesFromDb(identityId);
  return useMemo(
    () => ({ refreshNodesFromDb, refreshMessagesFromDb }),
    [refreshNodesFromDb, refreshMessagesFromDb],
  );
}
