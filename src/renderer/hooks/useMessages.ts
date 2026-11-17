import { useMemo } from 'react';

import { compareChatReceiveOrder } from '../lib/chatReceiveOrder';
import type { IdentityId } from '../lib/types';
import type { MessageRecord } from '../stores/messageStore';
import { useMessageStore } from '../stores/messageStore';

const EMPTY: MessageRecord[] = [];

/** An identity's chat rows in the order this app received them (see `chatReceiveOrder.ts`). */
export function useMessages(identityId: IdentityId | null): MessageRecord[] {
  const byId = useMessageStore((s) => (identityId ? s.messages[identityId] : undefined));
  return useMemo(() => {
    if (!byId) return EMPTY;
    return Object.values(byId).sort((a, b) => compareChatReceiveOrder(a, b));
  }, [byId]);
}
