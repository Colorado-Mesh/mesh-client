import type { MeshNode } from './types';

/**
 * XOR-fold pubkey bytes into a stable unsigned 32-bit node ID.
 * Expects a 32-byte MeshCore public key; returns 0 for any other length.
 */
export function pubkeyToNodeId(key: Uint8Array): number {
  if (key.length !== 32) return 0;
  let result = 0;
  for (let i = 0; i < key.length; i += 4) {
    const word =
      key[i] | 0 | ((key[i + 1] | 0) << 8) | ((key[i + 2] | 0) << 16) | ((key[i + 3] | 0) << 24);
    result = (result ^ word) >>> 0;
  }
  return result >>> 0;
}

export const CONTACT_TYPE_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Chat',
  2: 'Repeater',
  3: 'Room',
};

interface MeshCoreContact {
  publicKey: Uint8Array;
  type: number;
  advName: string;
  lastAdvert: number;
  advLat: number;
  advLon: number;
}

export function meshcoreContactToMeshNode(contact: MeshCoreContact): MeshNode {
  const nodeId = pubkeyToNodeId(contact.publicKey);
  const lat = contact.advLat !== 0 ? contact.advLat / 1e7 : null;
  const lon = contact.advLon !== 0 ? contact.advLon / 1e7 : null;
  return {
    node_id: nodeId,
    long_name: contact.advName || `Node-${nodeId.toString(16).toUpperCase()}`,
    short_name: contact.advName?.slice(0, 4) || '????',
    hw_model: CONTACT_TYPE_LABELS[contact.type] ?? 'Unknown',
    snr: 0,
    battery: 0,
    last_heard: contact.lastAdvert,
    latitude: lat,
    longitude: lon,
  };
}
