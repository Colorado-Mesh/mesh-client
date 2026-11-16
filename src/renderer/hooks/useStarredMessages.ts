import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { parseStarred, type StarredMessage } from '../lib/chatPanelProtocolStorage';
import { starredStorageKey, subscribeStarred, updateStarred } from '../lib/starredMessageStore';
import type { MeshProtocol } from '../lib/types';

export interface UseStarredMessages {
  starred: StarredMessage[];
  /** Change the stored list (see `updateStarred` in `starredMessageStore`). */
  updateStarred: (update: (current: StarredMessage[]) => StarredMessage[]) => void;
}

function readSnapshot(protocol: MeshProtocol): string {
  try {
    return localStorage.getItem(starredStorageKey(protocol)) ?? '';
  } catch (e) {
    console.debug('[useStarredMessages] snapshot read failed', e);
    return '';
  }
}

/**
 * Starred messages for one protocol, read from the shared stored list. Every mounted view sees a
 * star as soon as any writer (Chat panel, Rooms panel, inbox) saves it, in this window or (via
 * `storage`) another one.
 */
export function useStarredMessages(protocol: MeshProtocol): UseStarredMessages {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsub = subscribeStarred((p) => {
        if (p === protocol) onChange();
      });
      const key = starredStorageKey(protocol);
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === key) onChange();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        unsub();
        window.removeEventListener('storage', onStorage);
      };
    },
    [protocol],
  );
  const getSnapshot = useCallback(() => readSnapshot(protocol), [protocol]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => '');

  // Parse the snapshot React checked, never a second read of storage, so the list shown is the
  // one in `raw` even if another window writes in between.
  const starred = useMemo(() => parseStarred(raw), [raw]);
  const update = useCallback(
    (fn: (current: StarredMessage[]) => StarredMessage[]) => {
      updateStarred(protocol, fn);
    },
    [protocol],
  );
  return { starred, updateStarred: update };
}
