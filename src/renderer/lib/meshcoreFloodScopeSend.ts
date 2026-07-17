/**
 * Temporarily apply a MeshCore flood-scope override around a single send,
 * always restoring the persisted radio-wide scope afterward.
 */

export type FloodScopeApplier = (hashtag: string) => Promise<void>;

let floodScopeOverrideMutex: Promise<void> = Promise.resolve();

/**
 * Run `send` with an optional ephemeral flood-scope override.
 * Restores `restoreHashtag` in `finally` even when send rejects.
 */
export async function withMeshcoreFloodScopeOverride(
  apply: FloodScopeApplier,
  restoreHashtag: string,
  overrideHashtag: string | undefined,
  send: () => Promise<void>,
): Promise<void> {
  // `undefined` = no override; empty string = temporarily clear flood scope.
  if (overrideHashtag === undefined) {
    await send();
    return;
  }

  const prev = floodScopeOverrideMutex;
  let release!: () => void;
  floodScopeOverrideMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;

  try {
    await apply(overrideHashtag);
    try {
      await send();
    } finally {
      try {
        await apply(restoreHashtag);
      } catch (restoreErr) {
        console.warn(
          '[meshcoreFloodScopeSend] failed to restore flood scope after send:',
          restoreErr,
        );
      }
    }
  } finally {
    release();
  }
}
