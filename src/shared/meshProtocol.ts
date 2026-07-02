/** Built-in protocols; extend when adding adapters (e.g. reticulum). */
export const REGISTERED_MESH_PROTOCOLS = ['meshtastic', 'meshcore', 'reticulum'] as const;

export type MeshProtocol = (typeof REGISTERED_MESH_PROTOCOLS)[number];

export function isMeshProtocol(value: string): value is MeshProtocol {
  return (REGISTERED_MESH_PROTOCOLS as readonly string[]).includes(value);
}

/** For SQLite CHECK(protocol IN (...)) — keep in sync with REGISTERED_MESH_PROTOCOLS. */
export function meshProtocolSqlInList(): string {
  return REGISTERED_MESH_PROTOCOLS.map((p) => `'${p}'`).join(',');
}

export const MESH_PROTOCOL_SET: ReadonlySet<string> = new Set(REGISTERED_MESH_PROTOCOLS);
