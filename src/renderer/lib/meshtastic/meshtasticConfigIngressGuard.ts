import type { IdentityId } from '../types';

const remoteTargets = new Map<IdentityId, number>();

export function setMeshtasticRemoteConfigTarget(
  identityId: IdentityId,
  nodeNum: number | null,
): void {
  if (nodeNum == null) {
    remoteTargets.delete(identityId);
    return;
  }
  remoteTargets.set(identityId, nodeNum);
}

export function shouldSuppressMeshtasticLocalConfigWrite(identityId: IdentityId): boolean {
  return remoteTargets.has(identityId);
}

export function clearMeshtasticConfigIngressGuardsForTests(): void {
  remoteTargets.clear();
}
