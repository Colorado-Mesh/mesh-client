import { useCallback, useState } from 'react';

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
export function useChatOrder(scope: string, items: readonly OrderedChat[]) {
  const key = `mesh-client:chatOrder:${scope}`;
  const [stored, setStored] = useState(() => ({ key, ids: readOrder(key) }));
  const ids = reconcileChatOrder(items, stored.key === key ? stored.ids : readOrder(key));
  const save = useCallback(
    (next: readonly string[]) => {
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
    [key],
  );
  return { ids, save };
}
