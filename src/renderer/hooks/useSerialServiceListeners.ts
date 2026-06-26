import { useEffect } from 'react';

import { routeSerialServiceDisconnect } from '../lib/serialDisconnectRouter';
import { attachSerialServiceDisconnectListener } from '../lib/serialPortRecovery';

/** Mount once from App.tsx — global Web Serial unplug detection for both protocols. */
export function useSerialServiceListeners(): void {
  useEffect(() => {
    return attachSerialServiceDisconnectListener(routeSerialServiceDisconnect);
  }, []);
}
