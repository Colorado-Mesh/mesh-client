/**
 * Thin facade over {@link useMeshCoreImpl} ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375) / [#377](https://github.com/Colorado-Mesh/mesh-client/issues/377)).
 * Implementation and legacy listeners live in `useMeshCore.impl.ts` and `lib/meshcore/`.
 */
export * from './useMeshCore.impl';
export { useMeshCoreImpl } from './useMeshCore.impl';

import { useMeshCoreImpl } from './useMeshCore.impl';

export function useMeshCore() {
  return useMeshCoreImpl();
}
