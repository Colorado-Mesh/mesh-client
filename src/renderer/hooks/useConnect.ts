import { useCallback } from 'react';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import type { IdentityId, TransportParams } from '../lib/types';

/**
 * Connect to a device or attach a new transport. Returns the resolved
 * IdentityId — same id is reused on reconnect of a previously-seen device
 * (via the transport-key persistence map).
 */
export function useConnect() {
  return useCallback((protocolType: string, params: TransportParams): Promise<IdentityId> => {
    return connectionDriver.connect(protocolType, params);
  }, []);
}
