import type { MeshNode, MeshProtocol } from './types';

/** Same ordering as ChatPanel: MeshCore prefers long then short; Meshtastic prefers short then long. */
export function nodeDisplayName(node: MeshNode | undefined, protocol: MeshProtocol): string {
  if (!node) return '';
  if (protocol === 'meshcore') {
    return node.long_name?.trim() || node.short_name?.trim() || '';
  }
  return node.short_name?.trim() || node.long_name?.trim() || '';
}

/**
 * Raw packet log / sniffer: chat-aligned display name when known, else uppercase hex node id (no 0x).
 */
export function nodeLabelForRawPacket(
  node: MeshNode | undefined,
  nodeId: number,
  protocol: MeshProtocol,
): string {
  const display = nodeDisplayName(node, protocol);
  if (display) return display;
  return nodeId.toString(16).toUpperCase();
}

/** Long name only, else hex — legacy; prefer {@link nodeLabelForRawPacket} for UI parity with chat. */
export function nodeLongNameOrHexLabel(node: MeshNode | undefined, nodeId: number): string {
  const raw = node?.long_name?.trim();
  if (raw) return raw;
  return nodeId.toString(16).toUpperCase();
}

/**
 * MeshCore raw packet sender column: explicit `0x…` node id plus chat-aligned name from `getNodeLabel`.
 * When the label is already the bare hex fallback, show `0x…` only once.
 */
export function meshcoreRawPacketSenderColumnText(
  fromNodeId: number,
  getNodeLabel: (id: number) => string,
): string {
  const label = getNodeLabel(fromNodeId);
  const bare = fromNodeId.toString(16).toUpperCase();
  const idHex = `0x${bare}`;
  if (label === bare) return idHex;
  return `${label} · ${idHex}`;
}
