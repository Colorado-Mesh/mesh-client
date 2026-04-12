import type { MeshNode } from './types';

/**
 * Raw Packets / detail views: show advertised long name when present, else uppercase hex node id.
 */
export function nodeLongNameOrHexLabel(node: MeshNode | undefined, nodeId: number): string {
  const raw = node?.long_name?.trim();
  if (raw) return raw;
  return nodeId.toString(16).toUpperCase();
}
