/**
 * MeshCore legacy side-effect hook ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375) /
 * [#377](https://github.com/Colorado-Mesh/mesh-client/issues/377)).
 *
 * Mount exactly once from {@link App.tsx}. Owns companion connection lifecycle, ingest, and
 * DB hydration until fully driver-owned. Use {@link useMeshcorePanelActions} and
 * {@link useProtocolConnectionActions} with injected instances — do not remount this hook.
 */
export * from './useMeshCore.impl';
export { useMeshCoreImpl } from './useMeshCore.impl';

import { useMeshCoreImpl } from './useMeshCore.impl';

export function useMeshCore() {
  return useMeshCoreImpl();
}
