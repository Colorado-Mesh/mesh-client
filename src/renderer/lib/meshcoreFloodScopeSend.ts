/**
 * Temporarily apply a MeshCore flood-scope override around a single send,
 * always restoring the persisted radio-wide scope afterward.
 *
 * While an override is active, concurrent MeshCore TX should wait on
 * {@link withMeshcoreFloodScopeMutex} so they do not inherit the temporary scope.
 */

import { meshcoreCompanionRepeaterRfBusy } from './meshcoreRepeaterRpcInFlight';

export type FloodScopeApplier = (hashtag: string) => Promise<void>;

let floodScopeOverrideMutex: Promise<void> = Promise.resolve();
let floodScopeOverrideActiveCount = 0;

/** True while any ephemeral flood-scope override is applied on the radio. */
export function isMeshcoreFloodScopeOverrideActive(): boolean {
  return floodScopeOverrideActiveCount > 0;
}

/**
 * Serialize work that must not run while a flood-scope override is in effect
 * (and serialize against other override-aware sends).
 */
export async function withMeshcoreFloodScopeMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = floodScopeOverrideMutex;
  let release!: () => void;
  floodScopeOverrideMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Run `send` with an optional ephemeral flood-scope override.
 * Restores `restoreHashtag` in `finally` even when send rejects.
 *
 * Failure point: radio-wide scope apply while other RF is mid-flight.
 * Fallback: refuse override when companion RF admin/trace is busy.
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

  if (meshcoreCompanionRepeaterRfBusy()) {
    throw new Error('meshcore.errors.floodScopeBusy');
  }

  await withMeshcoreFloodScopeMutex(async () => {
    floodScopeOverrideActiveCount += 1;
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
      floodScopeOverrideActiveCount -= 1;
    }
  });
}
