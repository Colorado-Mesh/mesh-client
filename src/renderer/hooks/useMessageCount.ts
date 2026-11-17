import type { IdentityId } from '../lib/types';
import { useMessageStore } from '../stores/messageStore';

/** Count only: re-renders the subscriber when the count changes, not on every field update. */
export function useMessageCount(identityId: IdentityId | null): number {
  return useMessageStore((s) =>
    identityId ? Object.keys(s.messages[identityId] ?? {}).length : 0,
  );
}
