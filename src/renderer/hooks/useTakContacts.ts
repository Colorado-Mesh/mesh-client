import { useEffect } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { TAK_CONTACT_LOCAL_PRUNE_MS } from '@/renderer/lib/timeConstants';
import { useTakContactStore } from '@/renderer/stores/takContactStore';

/** Keeps `takContactStore` in sync with main's inbound CoT contacts. Mount once from App. */
export function useTakContacts(): void {
  useEffect(() => {
    const tak = window.electronAPI.tak;
    const { applyUpdate, replaceAll, pruneStale } = useTakContactStore.getState();
    const unsub = tak.onContacts(applyUpdate);
    let cancelled = false;
    void tak
      .getContacts()
      .then((contacts) => {
        if (!cancelled) replaceAll(contacts);
      })
      .catch((e: unknown) => {
        console.warn('[useTakContacts] getContacts failed ' + errLikeToLogString(e));
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
