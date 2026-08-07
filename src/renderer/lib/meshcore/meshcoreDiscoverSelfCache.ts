import type { MeshCoreSelfInfoWire } from '../meshcoreTelemetryPrivacy';

/**
 * ConnectionDriver calls {@link MeshCoreProtocol.discoverSelf} (getSelfInfo) before
 * `initConn`. TCP OpenHop companions often FIN under duplicate self-info RPCs —
 * stash the wire payload so sequential TCP init can skip a second getSelfInfo.
 */
const cache = new WeakMap<object, MeshCoreSelfInfoWire>();

export function rememberMeshcoreDiscoverSelf(handle: unknown, info: MeshCoreSelfInfoWire): void {
  if (handle == null || typeof handle !== 'object') return;
  cache.set(handle, info);
}

/** Take-and-clear cached discoverSelf payload for this connection handle. */
export function takeMeshcoreDiscoverSelfCache(handle: unknown): MeshCoreSelfInfoWire | undefined {
  if (handle == null || typeof handle !== 'object') return undefined;
  const info = cache.get(handle);
  if (info) cache.delete(handle);
  return info;
}
