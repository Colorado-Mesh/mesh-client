import { errLikeToLogString } from '../errLikeToLogString';

export interface MeshcoreDbHydrationOptions {
  hydrateMessages: boolean;
  beforeCommit?: () => boolean;
}

/**
 * Mount-time MeshCore SQLite hydration ([#375]). Caller supplies `reload` from the legacy hook
 * until hydration runs from driver connect.
 */
export function runMeshcoreMountHydration(
  reload: (opts: MeshcoreDbHydrationOptions) => Promise<void>,
): () => void {
  let cancelled = false;
  void reload({
    hydrateMessages: true,
    beforeCommit: () => !cancelled,
  }).catch((e: unknown) => {
    if (!cancelled) {
      console.warn('[meshcoreDbHydration] mount load failed ' + errLikeToLogString(e));
    }
  });
  return () => {
    cancelled = true;
  };
}
