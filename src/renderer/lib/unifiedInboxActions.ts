import type { MeshProtocol } from '@/shared/meshProtocol';

import { loadStarred, saveStarred, type StarredMessage } from './chatPanelProtocolStorage';
import type { UnifiedInboxItem } from './unifiedInbox';

/**
 * Dispatched on `window` after the inbox writes starred messages to localStorage so a mounted
 * ChatPanel can reload its in-memory `starred` state (otherwise its persist effect would later
 * overwrite the inbox's additions).
 */
export const STARRED_EXTERNAL_EVENT = 'mesh-client:starred-external';

export interface StarredExternalDetail {
  protocol: MeshProtocol;
}

function toStarredMessage(item: UnifiedInboxItem, starredAt: number): StarredMessage {
  const { message: m } = item;
  return {
    starId: item.starId,
    timestamp: m.timestamp,
    payload: m.payload,
    sender_name: m.sender_name,
    sender_id: m.sender_id,
    viewKey: item.viewKey,
    channel: m.channel,
    to: m.to ?? null,
    starredAt,
  };
}

/**
 * Star inbox rows into each protocol's existing `mesh-client:starred:<protocol>` document.
 * Idempotent: rows already starred are skipped. Returns how many new stars were added.
 *
 * Failure point: `saveStarred` swallows storage errors (logs at debug), so on a quota failure
 * the returned count can overstate what persisted; nothing else is mutated in that case.
 */
export function starInboxItems(items: readonly UnifiedInboxItem[], now = Date.now()): number {
  const byProtocol = new Map<MeshProtocol, UnifiedInboxItem[]>();
  for (const item of items) {
    const list = byProtocol.get(item.protocol) ?? [];
    list.push(item);
    byProtocol.set(item.protocol, list);
  }

  let added = 0;
  for (const [protocol, list] of byProtocol) {
    const existing = loadStarred(protocol);
    const have = new Set(existing.map((s) => s.starId));
    const fresh: StarredMessage[] = [];
    for (const item of list) {
      if (have.has(item.starId)) continue;
      have.add(item.starId);
      fresh.push(toStarredMessage(item, now));
    }
    if (fresh.length === 0) continue;
    saveStarred(protocol, [...existing, ...fresh]);
    added += fresh.length;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<StarredExternalDetail>(STARRED_EXTERNAL_EVENT, { detail: { protocol } }),
      );
    }
  }
  return added;
}
