import { useEffect, useRef } from 'react';

import type { MeshProtocol } from '../lib/types';

/**
 * Re-resolve our position when the active protocol changes. Inactive runtimes skip position
 * resolves, so the newly active one may still hold no position from launch. Skips the first
 * mount because each runtime already resolves on mount.
 */
export function useRefreshPositionOnProtocolSwitch(
  protocol: MeshProtocol,
  refresh: () => void,
): void {
  const lastProtocolRef = useRef(protocol);

  useEffect(() => {
    if (lastProtocolRef.current === protocol) return;
    lastProtocolRef.current = protocol;
    refresh();
  }, [protocol, refresh]);
}
