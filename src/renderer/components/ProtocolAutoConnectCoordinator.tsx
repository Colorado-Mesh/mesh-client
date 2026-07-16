import { useProtocolRfAutoConnect } from '@/renderer/hooks/useProtocolRfAutoConnect';
import type { RfConnectAutomaticFn } from '@/renderer/lib/rfConnectionTypes';
import type { DeviceState } from '@/renderer/lib/types';

interface ProtocolAutoConnectCoordinatorProps {
  meshtastic: {
    state: DeviceState;
    connectAutomatic: RfConnectAutomaticFn;
  };
  meshcore: {
    state: DeviceState;
    connectAutomatic: RfConnectAutomaticFn;
  };
}

/**
 * Keeps remembered RF reconnects alive while ConnectionPanel is rendered only for the active tab.
 * App initializes dual-Noble ordering in a parent useLayoutEffect before this coordinator mounts.
 */
export function ProtocolAutoConnectCoordinator({
  meshtastic,
  meshcore,
}: ProtocolAutoConnectCoordinatorProps) {
  useProtocolRfAutoConnect({
    protocol: 'meshtastic',
    state: meshtastic.state,
    connectAutomatic: meshtastic.connectAutomatic,
  });
  useProtocolRfAutoConnect({
    protocol: 'meshcore',
    state: meshcore.state,
    connectAutomatic: meshcore.connectAutomatic,
  });

  return null;
}
