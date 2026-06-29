import { useMemo } from 'react';

import type { MeshProtocol } from '../lib/types';
import type { MeshcoreRuntime, MeshtasticRuntime } from '../runtime/runtimeTypes';
import { useMeshcorePanelActions } from './useMeshcorePanelActions';
import { useMeshtasticPanelActions } from './useMeshtasticPanelActions';
import type { PanelActions } from './usePanelActions';

export type PanelActionsByProtocol = Record<MeshProtocol, PanelActions>;

/** @deprecated Use PanelActionsByProtocol */
export type DualProtocolPanelActions = PanelActionsByProtocol;

/**
 * Single construction site for per-protocol panel action bundles (avoids duplicate hooks in App + facade).
 * Each panel-actions hook is called unconditionally (Rules of Hooks).
 */
export function useAllProtocolPanelActions(runtimes: {
  meshtastic: MeshtasticRuntime;
  meshcore: MeshcoreRuntime;
}): PanelActionsByProtocol {
  const meshtasticActions = useMeshtasticPanelActions(runtimes.meshtastic);
  const meshcoreActions = useMeshcorePanelActions(runtimes.meshcore);
  return useMemo(
    () => ({ meshtastic: meshtasticActions, meshcore: meshcoreActions }),
    [meshtasticActions, meshcoreActions],
  );
}

/** @deprecated Use useAllProtocolPanelActions */
export function useDualProtocolPanelActions(
  meshtastic: MeshtasticRuntime,
  meshcore: MeshcoreRuntime,
): PanelActionsByProtocol {
  return useAllProtocolPanelActions({ meshtastic, meshcore });
}
