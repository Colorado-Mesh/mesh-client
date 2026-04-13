import type { MeshNode } from './types';

/** Minimal node when opening Node Detail from an id not yet in `nodes` (e.g. raw packet click). */
export function meshNodeStubForDetailModal(nodeId: number): MeshNode {
  const hex = nodeId.toString(16).toUpperCase();
  return {
    node_id: nodeId,
    long_name: `Node-${hex}`,
    short_name: '',
    hw_model: 'Unknown',
    battery: 0,
    snr: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
  };
}
