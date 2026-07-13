import { create } from 'zustand';

export interface ReticulumIdentityStatus {
  configured: boolean;
  identity_hash: string;
  lxmf_hash: string;
  display_name?: string | null;
}

interface ReticulumIdentityState {
  identity: ReticulumIdentityStatus | null;
  setIdentity: (identity: ReticulumIdentityStatus | null) => void;
}

const DEFAULT_IDENTITY: ReticulumIdentityStatus | null = null;

/** Monotonic generation — bump to invalidate in-flight identity fetches. */
let identityFetchGeneration = 0;

export function beginReticulumIdentityFetch(): number {
  return identityFetchGeneration;
}

/** Invalidate in-flight fetches (e.g. sidecar stopped). */
export function bumpReticulumIdentityFetchGeneration(): number {
  identityFetchGeneration += 1;
  return identityFetchGeneration;
}

export function isReticulumIdentityFetchCurrent(generation: number): boolean {
  return generation === identityFetchGeneration;
}

let identityRefreshInFlight: Promise<void> | null = null;

/**
 * Single-flight identity fetch shared across hook instances.
 * Failure point: proxyGet timeout — caller logs; stale identity may remain.
 */
export async function refreshReticulumIdentityShared(
  fetchFn: () => Promise<ReticulumIdentityStatus>,
  generation: number,
): Promise<void> {
  if (!isReticulumIdentityFetchCurrent(generation)) return;
  if (identityRefreshInFlight) {
    await identityRefreshInFlight;
    return;
  }
  identityRefreshInFlight = (async () => {
    try {
      const body = await fetchFn();
      if (isReticulumIdentityFetchCurrent(generation)) {
        useReticulumIdentityStore.getState().setIdentity(body);
      }
    } finally {
      identityRefreshInFlight = null;
    }
  })();
  await identityRefreshInFlight;
}

export const useReticulumIdentityStore = create<ReticulumIdentityState>((set) => ({
  identity: DEFAULT_IDENTITY,
  setIdentity: (identity) => {
    set({ identity });
  },
}));

export function resetReticulumIdentityStoreForTests(): void {
  identityFetchGeneration = 0;
  identityRefreshInFlight = null;
  useReticulumIdentityStore.setState({ identity: DEFAULT_IDENTITY });
}
