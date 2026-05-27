import { useCallback } from 'react';

import { type OurPosition, resolveOurPosition } from '../lib/gpsSource';
import { parseStoredJson } from '../lib/parseStoredJson';
import type { IdentityId } from '../lib/types';
import { setConnection } from '../stores/connectionStore';
import { setOurPosition } from '../stores/deviceStore';
import { useNodeStore } from '../stores/nodeStore';

/**
 * One-shot GPS resolve. Writes the result to deviceStore.ourPosition for the
 * identity. A future GpsPoller module started by ConnectionDriver will own the
 * recurring poll loop and the "push to device" path.
 */
export function useRefreshOurPosition(identityId: IdentityId | null) {
  return useCallback(async (): Promise<OurPosition | null> => {
    if (!identityId) return null;
    setConnection(identityId, { gpsLoading: true });
    try {
      const selfNum = useNodeStore.getState().nodes[identityId];
      const myNode = selfNum ? Object.values(selfNum)[0] : undefined;
      let staticLat: number | undefined;
      let staticLon: number | undefined;
      const s = parseStoredJson<{ staticLat?: number; staticLon?: number }>(
        localStorage.getItem('mesh-client:gpsSettings'),
        'useRefreshOurPosition gpsSettings',
      );
      if (s && typeof s.staticLat === 'number' && typeof s.staticLon === 'number') {
        staticLat = s.staticLat;
        staticLon = s.staticLon;
      }
      const devLat = staticLat != null ? undefined : myNode?.latitude;
      const devLon = staticLon != null ? undefined : myNode?.longitude;
      const pos = await resolveOurPosition(devLat, devLon, staticLat, staticLon);
      setOurPosition(identityId, pos);
      return pos;
    } finally {
      setConnection(identityId, { gpsLoading: false });
    }
  }, [identityId]);
}

/** Persist a new GPS poll interval. Future GpsPoller will pick this up. */
export function useUpdateGpsInterval(identityId: IdentityId | null) {
  return useCallback(
    (secs: number): void => {
      if (!identityId) return;
      setConnection(identityId, { gpsIntervalMs: secs > 0 ? secs * 1000 : 0 });
    },
    [identityId],
  );
}
