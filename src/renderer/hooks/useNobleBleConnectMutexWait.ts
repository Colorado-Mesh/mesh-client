import { useEffect, useState } from 'react';

import {
  dualNobleBleBothRadiosConfigured,
  getNobleBleConnectMutexSnapshot,
  subscribeNobleBleConnectMutexWait,
} from '../lib/meshcoreDualNobleBleInit';
import type { MeshProtocol } from '../lib/types';

/** Reactive Noble BLE connect mutex state for Connection panel wait notices. */
export function useNobleBleConnectMutexWait(protocol: MeshProtocol) {
  const [snapshot, setSnapshot] = useState(getNobleBleConnectMutexSnapshot);
  useEffect(
    () =>
      subscribeNobleBleConnectMutexWait(() => {
        setSnapshot(getNobleBleConnectMutexSnapshot());
      }),
    [],
  );
  const peer: MeshProtocol = protocol === 'meshcore' ? 'meshtastic' : 'meshcore';
  const waitingForPeer =
    snapshot.queued === protocol && snapshot.active === peer && snapshot.active !== null;
  const waitingForPrimaryAutoConnect =
    dualNobleBleBothRadiosConfigured() &&
    snapshot.primaryProtocol !== null &&
    protocol !== snapshot.primaryProtocol &&
    snapshot.primaryAutoConnectInFlight;
  return {
    ...snapshot,
    waitingForPeer,
    waitingForPrimaryAutoConnect,
    waitingOnNobleBlePeer: waitingForPeer || waitingForPrimaryAutoConnect,
    peer,
  };
}
