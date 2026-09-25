import { useShallow } from 'zustand/react/shallow';

import type { IdentityId } from '../lib/types';
import { useConnectionStore } from '../stores/connectionStore';

/** Queue depth from identity-scoped connection store (PacketRouter `queue_status`). */
export function useConnectionQueue(
  identityId: IdentityId | null,
): { free: number; maxlen: number } | null {
  return useConnectionStore(
    useShallow((s) => {
      if (!identityId) return null;
      const c = s.connections[identityId];
      if (c?.queueFree == null || c.queueMax == null) return null;
      return { free: c.queueFree, maxlen: c.queueMax };
    }),
  );
}
