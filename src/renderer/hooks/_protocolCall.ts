import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import type { IdentityId } from '../lib/types';
import type { IdentityRecord } from '../stores/identityStore';
import { useIdentityStore } from '../stores/identityStore';

/**
 * Shared resolver for action hooks: read identity from the store and fetch the
 * live SDK handle from ConnectionDriver. Returns null and logs when either is
 * missing so action hooks can early-out without throwing.
 */
export function resolveCall(
  identityId: IdentityId | null,
  tag: string,
): { identity: IdentityRecord; handle: unknown } | null {
  if (!identityId) return null;
  const identity = useIdentityStore.getState().identities[identityId];
  if (!identity) {
    console.warn(`[${tag}] no identity for`, identityId);
    return null;
  }
  const handle = connectionDriver.getHandle(identityId);
  if (!handle) {
    console.warn(`[${tag}] no handle for`, identityId);
    return null;
  }
  return { identity, handle };
}
