import { useCallback } from 'react';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import type { IdentityId } from '../lib/types';

/** Disconnect all live transports for the identity. Store slices remain (per plan). */
export function useDisconnect() {
  return useCallback(
    (identityId: IdentityId): Promise<void> => connectionDriver.disconnect(identityId),
    [],
  );
}
