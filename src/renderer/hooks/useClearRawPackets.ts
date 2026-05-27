import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { clearRawPackets } from '../stores/deviceStore';

export function useClearRawPackets(identityId: IdentityId | null) {
  return useCallback(() => {
    if (!identityId) return;
    clearRawPackets(identityId);
  }, [identityId]);
}
