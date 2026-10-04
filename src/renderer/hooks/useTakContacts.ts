import { useEffect } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { TAK_CONTACT_LOCAL_PRUNE_MS } from '@/renderer/lib/timeConstants';
import { useTakContactStore } from '@/renderer/stores/takContactStore';
import type { TAKContactsUpdate } from '@/shared/tak-types';

/** Keeps `takContactStore` in sync with main's inbound CoT contacts. Mount once from App. */
export function useTakContacts(): void {
  useEffect(() => {
    const tak = window.electronAPI.tak;
    const { applyUpdate, replaceAll, pruneStale } = useTakContactStore.getState();
    // A delta can land before getContacts resolves. Applying it immediately would lose it when
    // replaceAll installs the older snapshot, so hold deltas until that snapshot is in place.
    const pending: TAKContactsUpdate[] = [];
    let snapshotApplied = false;
    const unsub = tak.onContacts((update) => {
      if (snapshotApplied) applyUpdate(update);
      else pending.push(update);
    });
    let cancelled = false;
    const flushPending = () => {
      snapshotApplied = true;
      for (const update of pending.splice(0)) applyUpdate(update);
    };
    void tak
      .getContacts()
      .then((contacts) => {
        if (cancelled) return;
        replaceAll(contacts);
        flushPending();
      })
      .catch((e: unknown) => {
        console.warn('[useTakContacts] getContacts failed ' + errLikeToLogString(e));
        if (!cancelled) flushPending();
      });
    const pruneTimer = setInterval(() => {
      pruneStale();
    }, TAK_CONTACT_LOCAL_PRUNE_MS);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(pruneTimer);
    };
  }, []);
}
