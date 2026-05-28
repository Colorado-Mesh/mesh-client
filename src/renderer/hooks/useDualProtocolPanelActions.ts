import { useMemo } from 'react';

import type { MeshcoreRuntime, MeshtasticRuntime } from '../runtime/runtimeTypes';
import { useMeshcorePanelActions } from './useMeshcorePanelActions';
import { useMeshtasticPanelActions } from './useMeshtasticPanelActions';

export interface DualProtocolPanelActions {
  meshtastic: ReturnType<typeof useMeshtasticPanelActions>;
  meshcore: ReturnType<typeof useMeshcorePanelActions>;
}

/** Single construction site for both protocol panel action bundles (avoids duplicate hooks in App + facade). */
export function useDualProtocolPanelActions(
  meshtastic: MeshtasticRuntime,
  meshcore: MeshcoreRuntime,
): DualProtocolPanelActions {
  const meshtasticActions = useMeshtasticPanelActions(meshtastic);
  const meshcoreActions = useMeshcorePanelActions(meshcore);
  return useMemo(
    () => ({ meshtastic: meshtasticActions, meshcore: meshcoreActions }),
    [meshtasticActions, meshcoreActions],
  );
}
