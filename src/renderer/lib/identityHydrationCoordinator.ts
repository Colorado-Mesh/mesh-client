import type { IdentityId, MeshProtocol } from './types';

type HydrationKey = `${MeshProtocol}:${IdentityId}`;

const hydrationGeneration = new Map<HydrationKey, number>();

function hydrationKey(protocol: MeshProtocol, identityId: IdentityId): HydrationKey {
  return `${protocol}:${identityId}`;
}

/**
 * Marks the start of a hydration pass for protocol+identity. Returns `isCurrent` to drop
 * stale results when a newer hydration supersedes this one (overlapping App/runtime calls).
 */
export function beginIdentityHydration(
  protocol: MeshProtocol,
  identityId: IdentityId,
): () => boolean {
  const key = hydrationKey(protocol, identityId);
  const next = (hydrationGeneration.get(key) ?? 0) + 1;
  hydrationGeneration.set(key, next);
  return () => hydrationGeneration.get(key) === next;
}

/** Test-only reset. */
export function resetIdentityHydrationCoordinatorForTests(): void {
  hydrationGeneration.clear();
}
