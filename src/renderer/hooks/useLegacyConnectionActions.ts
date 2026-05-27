import type { MeshProtocol } from '../lib/types';
import type { UseDeviceReturn, UseMeshCoreReturn } from './legacyHookTypes';
import {
  type ProtocolConnectionActions,
  useProtocolConnectionActions,
} from './useProtocolConnection';

export type LegacyConnectionActions = ProtocolConnectionActions;

/**
 * @deprecated Prefer {@link useProtocolConnectionActions} with injected legacy instances.
 * Kept for call-site clarity during migration ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375)).
 */
export function useLegacyConnectionActions(
  protocol: MeshProtocol,
  meshtastic: UseDeviceReturn,
  meshcore: UseMeshCoreReturn,
): LegacyConnectionActions {
  return useProtocolConnectionActions(protocol, meshtastic, meshcore);
}
