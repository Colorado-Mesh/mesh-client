import type { MeshProtocol } from '@/shared/meshProtocol';

import { loadStarred, saveStarred, type StarredMessage } from './chatPanelProtocolStorage';
import { errLikeToLogString } from './errLikeToLogString';

/**
 * Shared source of truth for starred messages: the `mesh-client:starred:<protocol>` document.
 *
 * The Chat panel, the Rooms panel (MeshCore) and the unified inbox all write the same document.
 * Each change goes through `updateStarred`, which applies it to the stored list as it is at that
 * moment, so no writer can replace stars another writer added with an older in-memory copy.
 * Mounted views re-read the document when `subscribeStarred` fires (this window) or on the
 * `storage` event (another window); see `useStarredMessages`.
 */

export function starredStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:starred:${protocol}`;
}

type StarredListener = (protocol: MeshProtocol) => void;
const listeners = new Set<StarredListener>();

/** Called after every `updateStarred` write for a protocol. Returns an unsubscribe function. */
export function subscribeStarred(listener: StarredListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyStarredChanged(protocol: MeshProtocol): void {
  for (const listener of [...listeners]) {
    try {
      listener(protocol);
    } catch (e) {
      console.warn('[starredMessageStore] listener failed ' + errLikeToLogString(e));
    }
  }
}

/**
 * Apply `update` to the stored starred list and save the result. Returning the list it was given
 * skips the write.
 *
 * Failure point: `saveStarred` swallows storage errors (debug log), so on a quota failure the
 * stored list keeps its previous stars and every view that re-reads it shows those.
 */
export function updateStarred(
  protocol: MeshProtocol,
  update: (current: StarredMessage[]) => StarredMessage[],
): void {
  const current = loadStarred(protocol);
  const next = update(current);
  if (next === current) return;
  saveStarred(protocol, next);
  notifyStarredChanged(protocol);
}
