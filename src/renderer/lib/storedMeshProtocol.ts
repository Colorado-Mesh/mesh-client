import type { MeshProtocol } from './types';

/** Same key as `App` protocol persistence — single source of truth for UI + diagnostics gating. */
export const MESH_PROTOCOL_STORAGE_KEY = 'mesh-client:protocol';

export function getStoredMeshProtocol(): MeshProtocol {
  const v = localStorage.getItem(MESH_PROTOCOL_STORAGE_KEY);
  return v === 'meshcore' ? 'meshcore' : 'meshtastic';
}
