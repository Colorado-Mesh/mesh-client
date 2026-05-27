import { useMemo } from 'react';

import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import { useRadioProvider } from '../lib/radio/providerFactory';
import type { IdentityId, MeshProtocol } from '../lib/types';
import type { MeshcoreRuntime, MeshtasticRuntime } from '../runtime/runtimeTypes';
import { useMeshcorePanelActions } from './useMeshcorePanelActions';
import { useMeshtasticPanelActions } from './useMeshtasticPanelActions';

export type PanelActions =
  | ReturnType<typeof useMeshtasticPanelActions>
  | ReturnType<typeof useMeshcorePanelActions>;

export interface PanelActionsBundle {
  actions: PanelActions;
  capabilities: ProtocolCapabilities;
  protocol: MeshProtocol;
  identityId: IdentityId | null;
}

/**
 * Identity-scoped panel write facade ([#377]). Resolves runtime instances by protocol
 * without App-level `protocol ===` for action selection.
 */
export function usePanelActions(
  protocol: MeshProtocol,
  identityId: IdentityId | null,
  meshtastic: MeshtasticRuntime,
  meshcore: MeshcoreRuntime,
): PanelActionsBundle {
  const meshtasticActions = useMeshtasticPanelActions(meshtastic);
  const meshcoreActions = useMeshcorePanelActions(meshcore);
  const capabilities = useRadioProvider(protocol);

  const actionsByProtocol = useMemo(
    (): Record<MeshProtocol, PanelActions> => ({
      meshtastic: meshtasticActions,
      meshcore: meshcoreActions,
    }),
    [meshtasticActions, meshcoreActions],
  );

  const actions = actionsByProtocol[protocol];

  return useMemo(
    () => ({ actions, capabilities, protocol, identityId }),
    [actions, capabilities, protocol, identityId],
  );
}
