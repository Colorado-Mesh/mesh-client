import { useProtocolRfAutoConnect } from '@/renderer/hooks/useProtocolRfAutoConnect';
import type { RfConnectAutomaticFn } from '@/renderer/lib/rfConnectionTypes';
import type { DeviceState } from '@/renderer/lib/types';

export interface ProtocolAutoConnectTarget {
  state: DeviceState;
  connectAutomatic: RfConnectAutomaticFn;
  /** False when the protocol is disabled in App → Protocols. */
  enabled?: boolean;
}

export interface ProtocolAutoConnectCoordinatorProps {
  meshtastic: ProtocolAutoConnectTarget;
  meshcore: ProtocolAutoConnectTarget;
  meshcom: ProtocolAutoConnectTarget;
}

/**
 * Keeps remembered RF reconnects alive while ConnectionPanel is rendered only for the active tab.
 * App initializes dual-Noble ordering in a parent useLayoutEffect before this coordinator mounts.
 */
export function ProtocolAutoConnectCoordinator({
  meshtastic,
  meshcore,
  meshcom,
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
  useProtocolRfAutoConnect({
    protocol: 'meshcom',
    state: meshcom.state,
    connectAutomatic: meshcom.connectAutomatic,
    enabled: meshcom.enabled ?? true,
  });

  return null;
}
