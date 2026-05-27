import type { NodeRecord } from '../stores/nodeStore';

/** Minimal node when opening Node Detail from an id not yet in `nodes` (e.g. raw packet click). */
export function meshNodeStubForDetailModal(nodeId: number): NodeRecord {
  const hex = nodeId.toString(16).toUpperCase();
  return {
    nodeId,
    longName: `Node-${hex}`,
    shortName: '',
    hwModel: 'Unknown',
    batteryLevel: 0,
    snr: 0,
    lastHeardAt: 0,
  };
}
