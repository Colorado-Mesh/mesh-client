import type { MeshProtocol } from '@/shared/meshProtocol';

import { createMeshcomRuntimeDisabledStub } from './meshcomRuntimeDisabledStub';
import type { ProtocolRuntime } from './protocolRuntime';

/**
 * Disabled / pre-live runtime factories keyed by protocol. Protocols that always
 * mount a live hook leave their slot unset. When adding a lazy/hidden protocol,
 * register its stub here so {@link protocolRuntimeAppPaint.test.ts} covers it
 * automatically via {@link REGISTERED_MESH_PROTOCOLS}.
 */
export const PROTOCOL_RUNTIME_DISABLED_STUBS = {
  meshcom: createMeshcomRuntimeDisabledStub,
} as const satisfies Partial<
  Record<MeshProtocol, () => ProtocolRuntime>
>; /** Stub for `protocol` when App may put a pre-live / hidden stand-in in RuntimeMap. */
export function getProtocolRuntimeDisabledStub(
  protocol: MeshProtocol,
): ProtocolRuntime | undefined {
  const factory = (
    PROTOCOL_RUNTIME_DISABLED_STUBS as Partial<Record<MeshProtocol, () => ProtocolRuntime>>
  )[protocol];
  return factory?.();
}
