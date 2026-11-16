import type { MeshProtocol } from '@/shared/meshProtocol';

import type { StarredMessage } from './chatPanelProtocolStorage';
import { updateStarred } from './starredMessageStore';
import type { UnifiedInboxItem } from './unifiedInbox';

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
 * Star inbox rows into each protocol's shared `mesh-client:starred:<protocol>` list, through
 * `updateStarred` so mounted Chat and Rooms panels show them at once and keep them.
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
    updateStarred(protocol, (existing) => {
      const have = new Set(existing.map((s) => s.starId));
      const fresh: StarredMessage[] = [];
      for (const item of list) {
        if (have.has(item.starId)) continue;
        have.add(item.starId);
        fresh.push(toStarredMessage(item, now));
      }
      added += fresh.length;
      return fresh.length === 0 ? existing : [...existing, ...fresh];
    });
  }
  return added;
}
