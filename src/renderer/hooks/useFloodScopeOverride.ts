import { useCallback, useSyncExternalStore } from 'react';

import {
  loadFloodScopeOverridesInitial,
  subscribeFloodScopeOverrides,
} from '../lib/chatPanelProtocolStorage';
import type { MeshProtocol } from '../lib/types';

export function useFloodScopeOverride(protocol: MeshProtocol, key: string | null): string {
  const subscribe = useCallback(
    (onChange: () => void) =>
      subscribeFloodScopeOverrides((changedProtocol) => {
        if (changedProtocol === protocol) onChange();
      }),
    [protocol],
  );
  const snapshot = useCallback(
    () => (key ? (loadFloodScopeOverridesInitial(protocol)[key] ?? '') : ''),
    [protocol, key],
  );
  return useSyncExternalStore(subscribe, snapshot);
}
