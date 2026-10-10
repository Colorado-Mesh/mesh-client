import type { MeshProtocol } from './types';

/** Per-protocol value map keyed by {@link MeshProtocol}. */
export type ProtocolValues<T> = Record<MeshProtocol, T>;

export function protocolMap<T>(values: ProtocolValues<T>): ProtocolValues<T> {
  return values;
}

/** @deprecated Prefer {@link protocolMap} when protocols differ. */
export type ProtocolRecord<M, C = M> = ProtocolValues<M | C> & {
  meshtastic: M;
  meshcore: C;
};

/** Build a per-protocol map. */
export function protocolRecord<M, C = M>(meshtastic: M, meshcore: C): ProtocolValues<M | C> {
  return { meshtastic, meshcore };
}

/** Type-safe lookup without `protocol ===` ternaries in App. */
export function selectByProtocol<T>(map: ProtocolValues<T>, protocol: MeshProtocol): T {
  return map[protocol];
}
