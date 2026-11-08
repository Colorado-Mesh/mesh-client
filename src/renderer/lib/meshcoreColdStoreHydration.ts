/**
 * MeshCore runtime mount reload is the authoritative cold identity-store hydrate
 * (contacts + messages + hops after startup prune). App's post-prune refresh skips
 * MeshCore when the same identity bucket was already written so we do not double-fetch.
 */

let coldStoreHydratedIdentityId: string | null = null;

/** Record that mount hydrate wrote identity stores for `identityId`. */
export function markMeshcoreColdStoreHydrated(identityId: string): void {
  coldStoreHydratedIdentityId = identityId;
}

/**
 * True when mount hydrate already filled the identity bucket App would refresh.
 * Requires a matching identity id so a different/empty bucket is not skipped.
 */
export function hasMeshcoreColdStoreHydrated(identityId?: string | null): boolean {
  if (!coldStoreHydratedIdentityId || identityId == null || identityId === '') return false;
  return coldStoreHydratedIdentityId === identityId;
}

/** @internal Test helper. */
export function resetMeshcoreColdStoreHydratedForTests(): void {
  coldStoreHydratedIdentityId = null;
}
