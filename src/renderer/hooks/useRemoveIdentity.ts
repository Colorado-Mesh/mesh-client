import { useCallback } from 'react';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import type { IdentityId } from '../lib/types';

/**
 * "Forget this device" — disconnect, drop store slices, drop transport-key map.
 * Use this only on explicit user request; plain disconnect preserves slices.
 */
export function useRemoveIdentity() {
  return useCallback(
    (identityId: IdentityId): Promise<void> => connectionDriver.removeIdentity(identityId),
    [],
  );
}
