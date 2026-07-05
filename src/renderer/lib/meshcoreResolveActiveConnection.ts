import type { RefObject } from 'react';

import { connectionDriver } from './drivers/ConnectionDriver';
import { getIdentityIdForProtocol } from './identityByProtocol';
import type { MeshCoreConnection } from './meshcore/meshcoreHookTypes';

export interface MeshcoreActiveConnectionRefs {
  connRef: RefObject<MeshCoreConnection | null>;
  meshcoreDriverConnectedRef: RefObject<boolean>;
  meshcoreIdentityIdRef: RefObject<string | null>;
  meshcorePendingDriverIdentityRef: RefObject<string | null>;
}

/**
 * Return the live MeshCore RF handle. Re-syncs `connRef` from ConnectionDriver when the ref was
 * cleared (e.g. Strict Mode remount) but the driver slot is still connected.
 */
export function resolveMeshcoreActiveConnection(
  refs: MeshcoreActiveConnectionRefs,
): MeshCoreConnection | null {
  if (refs.connRef.current) return refs.connRef.current;

  const identityId =
    refs.meshcoreIdentityIdRef.current ??
    refs.meshcorePendingDriverIdentityRef.current ??
    getIdentityIdForProtocol('meshcore');

  if (!identityId) return null;

  const handle = connectionDriver.getHandle(identityId) as MeshCoreConnection | null;
  if (!handle) return null;

  refs.connRef.current = handle;
  refs.meshcoreDriverConnectedRef.current = true;
  if (!refs.meshcoreIdentityIdRef.current) {
    refs.meshcoreIdentityIdRef.current = identityId;
  }
  return handle;
}
