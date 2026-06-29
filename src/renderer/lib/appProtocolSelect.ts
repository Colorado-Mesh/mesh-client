import type { MeshProtocol } from './types';

/** Per-protocol map; meshtastic and meshcore values may differ (e.g. panel action bundles). */
export type ProtocolRecord<M, C = M> = Record<MeshProtocol, M | C> & {
  meshtastic: M;
  meshcore: C;
};

export function protocolRecord<M, C = M>(meshtastic: M, meshcore: C): ProtocolRecord<M, C> {
  return { meshtastic, meshcore };
}

/** Type-safe lookup without `protocol ===` ternaries in App. */
export function selectByProtocol<M, C, P extends MeshProtocol>(
  map: ProtocolRecord<M, C>,
  protocol: P,
): P extends 'meshtastic' ? M : C {
  return map[protocol] as P extends 'meshtastic' ? M : C;
}
