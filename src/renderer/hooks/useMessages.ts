import { useMemo } from 'react';

import type { IdentityId } from '../lib/types';
import type { MessageRecord } from '../stores/messageStore';
import { useMessageStore } from '../stores/messageStore';

const EMPTY: MessageRecord[] = [];

export function useMessages(identityId: IdentityId | null): MessageRecord[] {
  const byId = useMessageStore((s) => (identityId ? s.messages[identityId] : undefined));
  return useMemo(() => {
    if (!byId) return EMPTY;
    return Object.values(byId).sort((a, b) => a.timestamp - b.timestamp);
  }, [byId]);
}
