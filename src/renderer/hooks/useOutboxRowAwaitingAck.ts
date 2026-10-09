import { useCallback, useSyncExternalStore } from 'react';

import { isOutboxRowAwaitingAck, subscribeOutboxAwaitingAck } from '../lib/chatOutboxDrain';

/** True while the outbox drain waits for the network to acknowledge this row. */
export function useOutboxRowAwaitingAck(rowId: number): boolean {
  const getSnapshot = useCallback(() => isOutboxRowAwaitingAck(rowId), [rowId]);
  return useSyncExternalStore(subscribeOutboxAwaitingAck, getSnapshot);
}
