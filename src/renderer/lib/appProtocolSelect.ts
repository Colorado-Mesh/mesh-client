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

/** Build a per-protocol map; pass `reticulum` when the third protocol needs a distinct value. */
export function protocolRecord<M, C = M, R = C>(
  meshtastic: M,
  meshcore: C,
  reticulum: R = meshcore as unknown as R,
): ProtocolValues<M | C | R> {
  return { meshtastic, meshcore, reticulum };
}

/** Type-safe lookup without `protocol ===` ternaries in App. */
export function selectByProtocol<T>(map: ProtocolValues<T>, protocol: MeshProtocol): T {
  return map[protocol];
}
