import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  type ConversationPrefs,
  conversationPrefsStorageKey,
  loadConversationPrefs,
  saveConversationPrefs,
  subscribeConversationPrefs,
  toggleArchived,
  togglePinned,
} from '../lib/conversationPinStorage';
import type { MeshProtocol } from '../lib/types';

export interface UseConversationPins {
  pinned: ReadonlySet<string>;
  archived: ReadonlySet<string>;
  /** Pinned view keys in pin order (for stable ordering). */
  pinnedOrder: readonly string[];
  archivedOrder: readonly string[];
  togglePin: (viewKey: string) => boolean;
  toggleArchive: (viewKey: string) => boolean;
}

function readSnapshot(protocol: MeshProtocol, identityId: string | null): string {
  try {
    return localStorage.getItem(conversationPrefsStorageKey(protocol, identityId)) ?? '';
  } catch (e) {
    console.debug('[useConversationPins] snapshot read failed', e);
    return '';
  }
}

/**
 * Per-protocol / per-identity pin + archive state for chat conversations. Re-renders when this
 * hook's document changes in this window or (via `storage`) another one. Toggles return false
 * when the write failed; the stored document (and therefore the UI) is then unchanged.
 */
export function useConversationPins(
  protocol: MeshProtocol,
  identityId: string | null = null,
): UseConversationPins {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsub = subscribeConversationPrefs((p, id) => {
        if (p === protocol && id === identityId) onChange();
      });
      const key = conversationPrefsStorageKey(protocol, identityId);
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === key) onChange();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        unsub();
        window.removeEventListener('storage', onStorage);
      };
    },
    [protocol, identityId],
  );
  const getSnapshot = useCallback(() => readSnapshot(protocol, identityId), [protocol, identityId]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => '');

  const prefs = useMemo<ConversationPrefs>(
    () => loadConversationPrefs(protocol, identityId),
    // `raw` is the change signal: it updates whenever the stored document does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [protocol, identityId, raw],
  );
  const pinned = useMemo(() => new Set(prefs.pinned), [prefs.pinned]);
  const archived = useMemo(() => new Set(prefs.archived), [prefs.archived]);

  const togglePin = useCallback(
    (viewKey: string) =>
      saveConversationPrefs(
        protocol,
        identityId,
        togglePinned(loadConversationPrefs(protocol, identityId), viewKey),
      ),
    [protocol, identityId],
  );
  const toggleArchive = useCallback(
    (viewKey: string) =>
      saveConversationPrefs(
        protocol,
        identityId,
        toggleArchived(loadConversationPrefs(protocol, identityId), viewKey),
      ),
    [protocol, identityId],
  );

  return {
    pinned,
    archived,
    pinnedOrder: prefs.pinned,
    archivedOrder: prefs.archived,
    togglePin,
    toggleArchive,
  };
}
