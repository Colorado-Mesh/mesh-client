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

/**
 * Build a per-protocol map. Optional `reticulum` defaults to `meshcore`; optional
 * `meshcom` defaults to `meshcore` (never `reticulum` — that leaked RRC/Games/Nomad/Peers
 * into the MeshCom shell when three-arg call sites omitted the fourth value).
 */
export function protocolRecord<M, C = M, R = C, CM = C>(
  meshtastic: M,
  meshcore: C,
  reticulum: R = meshcore as unknown as R,
  meshcom: CM = meshcore as unknown as CM,
): ProtocolValues<M | C | R | CM> {
  return { meshtastic, meshcore, reticulum, meshcom };
}

/** Type-safe lookup without `protocol ===` ternaries in App. */
export function selectByProtocol<T>(map: ProtocolValues<T>, protocol: MeshProtocol): T {
  return map[protocol];
}
