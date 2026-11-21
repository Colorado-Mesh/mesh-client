import { useCallback, useEffect, useState } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

export interface OrderedChat {
  id: string;
  name: string;
}

export function reconcileChatOrder(
  items: readonly OrderedChat[],
  saved: readonly string[],
): string[] {
  const available = new Set(items.map((item) => item.id));
  const result = [...new Set(saved)].filter((id) => available.has(id));
  const seen = new Set(result);
  for (const item of items) {
    if (!seen.has(item.id)) {
      result.push(item.id);
      seen.add(item.id);
    }
  }
  return result;
}

export type ChatOrderSide = 'before' | 'after';

/**
 * Moves `id` next to `target` in a full display order. Entries that are not on screen stay next
 * to their neighbours. Returns null when the move would not change the order.
 */
export function moveChatOrderId(
  ids: readonly string[],
  id: string,
  target: string,
  side: ChatOrderSide,
): string[] | null {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return null;
  const next = ids.filter((entry) => entry !== id);
  next.splice(next.indexOf(target) + (side === 'after' ? 1 : 0), 0, id);
  return next.every((entry, index) => entry === ids[index]) ? null : next;
}

function readOrder(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch (error) {
    console.warn('[useChatOrder] read failed ' + errLikeToLogString(error));
    return [];
  }
}

/** Presentation order only: never renumber radio slots or change room membership. */
export function useChatOrder(scope: string | null, items: readonly OrderedChat[]) {
  const persist = scope != null;
  const key = persist ? `mesh-client:chatOrder:${scope}` : '';
  const [pendingWhileUnresolved, setPendingWhileUnresolved] = useState<string[] | null>(null);
  const [stored, setStored] = useState(() => ({
    key,
    ids: persist ? readOrder(key) : items.map((item) => item.id),
  }));

  useEffect(() => {
    if (!persist) return;
    if (stored.key === key) return;
    // scope change: load order for the new key (replaces render-phase setState).
    // Persist the full pending sequence (including ids absent from current items); the
    // render path below still reconciles to the visible set.
    const pending = pendingWhileUnresolved;
    const fromStorage = readOrder(key);
    const ids = pending != null && pending.length > 0 ? [...pending] : fromStorage;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync storage when chat order scope becomes known
    setStored({ key, ids });
    if (pending != null && pending.length > 0) {
      setPendingWhileUnresolved(null);
      try {
        localStorage.setItem(key, JSON.stringify(ids));
      } catch (error) {
        console.warn('[useChatOrder] flush pending order failed ' + errLikeToLogString(error));
      }
    }
  }, [key, items, pendingWhileUnresolved, persist, stored.key]);

  const ids = persist
    ? reconcileChatOrder(items, stored.ids)
    : reconcileChatOrder(
        items,
        pendingWhileUnresolved ??
          (stored.ids.length > 0 ? stored.ids : items.map((item) => item.id)),
      );
  const save = useCallback(
    (next: readonly string[]) => {
      if (!persist) {
        const visible = [...new Set(next)];
        const reconciled = reconcileChatOrder(items, visible);
        setPendingWhileUnresolved(reconciled);
        setStored({ key: '', ids: reconciled });
        return;
      }
      // Preserve absent ids so a temporary disconnect/filter cannot erase their chosen position.
      const prior = readOrder(key);
      const visible = [...new Set(next)];
      const visibleSet = new Set(visible);
      let index = 0;
      const ids = prior.map((id) => (visibleSet.has(id) ? visible[index++] : id));
      ids.push(...visible.slice(index));
      localStorage.setItem(key, JSON.stringify(ids));
      setStored({ key, ids });
    },
    [items, key, persist],
  );
  // Ordering UI stays available while scope is null; save() keeps order in memory and
  // flushes once myNodeNum resolves (see pendingWhileUnresolved). Do not gate the
  // Order chats control on `persist` — that broke offline DM tabs and E2E.
  return { ids, save, orderingEnabled: true };
}
