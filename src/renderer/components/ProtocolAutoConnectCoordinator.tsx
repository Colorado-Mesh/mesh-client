import { useProtocolRfAutoConnect } from '@/renderer/hooks/useProtocolRfAutoConnect';
import type { RfConnectAutomaticFn } from '@/renderer/lib/rfConnectionTypes';
import type { DeviceState } from '@/renderer/lib/types';

interface ProtocolAutoConnectTarget {
  state: DeviceState;
  connectAutomatic: RfConnectAutomaticFn;
  /** False when the protocol is disabled in App → Protocols. */
  enabled?: boolean;
}

interface ProtocolAutoConnectCoordinatorProps {
  meshtastic: ProtocolAutoConnectTarget;
  meshcore: ProtocolAutoConnectTarget;
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
    enabled: meshtastic.enabled ?? true,
  });
  useProtocolRfAutoConnect({
    protocol: 'meshcore',
    state: meshcore.state,
    connectAutomatic: meshcore.connectAutomatic,
    enabled: meshcore.enabled ?? true,
  });

  return null;
}
