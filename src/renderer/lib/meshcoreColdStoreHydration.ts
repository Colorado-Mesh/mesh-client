/**
 * MeshCore runtime mount reload is the authoritative cold identity-store hydrate
 * (contacts + messages + hops after startup prune). App's post-prune refresh skips
 * MeshCore when this flag is set so we do not double-fetch.
 */

let coldStoreHydrated = false;

export function markMeshcoreColdStoreHydrated(): void {
  coldStoreHydrated = true;
}

export function hasMeshcoreColdStoreHydrated(): boolean {
  return coldStoreHydrated;
}

/** @internal Test helper. */
export function resetMeshcoreColdStoreHydratedForTests(): void {
  coldStoreHydrated = false;
}
