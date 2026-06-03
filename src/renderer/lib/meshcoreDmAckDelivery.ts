import type { IdentityId } from '@/renderer/lib/types';

/** Params for firmware event 130 DM ACK tracking (useSendMessage / runtime send paths). */
export interface MeshcoreDmAckPendingParams {
  identityId: IdentityId;
  ackKeyU32: number;
  estTimeoutMs: number;
  destNodeId?: number;
}

type MeshcoreDmAckPendingImpl = (params: MeshcoreDmAckPendingParams) => void;

let impl: MeshcoreDmAckPendingImpl | null = null;

/** Registered by {@link useMeshcoreRuntime} while mounted (owns pendingAcksRef + event 130). */
export function setMeshcoreDmAckPendingImpl(fn: MeshcoreDmAckPendingImpl | null): void {
  impl = fn;
}

export function isMeshcoreDmAckPendingRegistered(): boolean {
  return impl != null;
}

/** Returns false when the MeshCore runtime has not registered ACK tracking yet. */
export function scheduleMeshcoreDmAckPending(params: MeshcoreDmAckPendingParams): boolean {
  if (!impl) return false;
  impl(params);
  return true;
}
