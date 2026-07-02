import { useMemo } from 'react';

import type { MeshProtocol } from '../lib/types';
import type { MeshcoreRuntime, MeshtasticRuntime, ReticulumRuntime } from '../runtime/runtimeTypes';
import { useMeshcorePanelActions } from './useMeshcorePanelActions';
import { useMeshtasticPanelActions } from './useMeshtasticPanelActions';
import type { PanelActions } from './usePanelActions';
import { useReticulumPanelActions } from './useReticulumPanelActions';

export type PanelActionsByProtocol = Record<MeshProtocol, PanelActions>;

/**
 * Single construction site for per-protocol panel action bundles (avoids duplicate hooks in App + facade).
 * Each panel-actions hook is called unconditionally (Rules of Hooks).
 */
export function useAllProtocolPanelActions(runtimes: {
  meshtastic: MeshtasticRuntime;
  meshcore: MeshcoreRuntime;
  reticulum: ReticulumRuntime;
}): PanelActionsByProtocol {
  const meshtasticActions = useMeshtasticPanelActions(runtimes.meshtastic);
  const meshcoreActions = useMeshcorePanelActions(runtimes.meshcore);
  const reticulumActions = useReticulumPanelActions(runtimes.reticulum);
  return useMemo(
    () => ({
      meshtastic: meshtasticActions,
      meshcore: meshcoreActions,
      reticulum: reticulumActions,
    }),
    [meshtasticActions, meshcoreActions, reticulumActions],
  );
}

/** @deprecated Use useAllProtocolPanelActions */
export function useDualProtocolPanelActions(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deprecated stub keeps legacy signature
  _meshtastic: MeshtasticRuntime,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deprecated stub keeps legacy signature
  _meshcore: MeshcoreRuntime,
): PanelActionsByProtocol {
  throw new Error(
    'useDualProtocolPanelActions requires reticulum runtime — use useAllProtocolPanelActions',
  );
}
