import { useMemo } from 'react';

import type { MeshProtocol } from '../lib/types';
import {
  type ProtocolConnectionActions,
  useProtocolConnectionActions,
} from './useProtocolConnection';

export type ConnectionActionsByProtocol = Record<MeshProtocol, ProtocolConnectionActions>;

/**
 * Single construction site for per-protocol connection action bundles (avoids duplicate hooks in App + facade).
 * Each connection-actions hook is called unconditionally (Rules of Hooks).
 */
export function useAllProtocolConnectionActions(): ConnectionActionsByProtocol {
  const meshtasticActions = useProtocolConnectionActions('meshtastic');
  const meshcoreActions = useProtocolConnectionActions('meshcore');
  const reticulumActions = useProtocolConnectionActions('reticulum');
  return useMemo(
    () => ({
      meshtastic: meshtasticActions,
      meshcore: meshcoreActions,
      reticulum: reticulumActions,
    }),
    [meshtasticActions, meshcoreActions, reticulumActions],
  );
}
