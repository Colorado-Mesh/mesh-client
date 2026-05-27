import type { MeshProtocol } from './types';
import type { NodeRecord } from '../stores/nodeStore';

/** Same ordering as ChatPanel: MeshCore prefers long then short; Meshtastic prefers short then long. */
export function nodeDisplayName(node: NodeRecord | undefined, protocol: MeshProtocol): string {
  if (!node) return '';
  if (protocol === 'meshcore') {
    return node.longName?.trim() || node.shortName?.trim() || '';
  }
  return node.shortName?.trim() || node.longName?.trim() || '';
}

/**
 * Raw packet log / sniffer: chat-aligned display name when known, else uppercase hex node id (no 0x).
 */
export function nodeLabelForRawPacket(
  node: NodeRecord | undefined,
  nodeId: number,
  protocol: MeshProtocol,
): string {
  const display = nodeDisplayName(node, protocol);
  if (display) return display;
  return nodeId.toString(16).toUpperCase();
}

/** Long name only, else hex — legacy; prefer {@link nodeLabelForRawPacket} for UI parity with chat. */
export function nodeLongNameOrHexLabel(node: NodeRecord | undefined, nodeId: number): string {
  const raw = node?.longName?.trim();
  if (raw) return raw;
  return nodeId.toString(16).toUpperCase();
}

/**
 * Picker-style label: "ShortName_XXXX" matching BLE picker format.
 * Falls back to `!fullhex` when no name is known.
 */
export function pickerStyleNodeLabel(node: NodeRecord | undefined, nodeNum: number): string {
  const fourHex = nodeNum.toString(16).slice(-4);
  if (node?.shortName) {
    if (/_[0-9a-fA-F]{4}$/.test(node.shortName)) return node.shortName;
    return `${node.shortName}_${fourHex}`;
  }
  if (node?.longName) {
    return node.longName.length > 7
      ? `${node.longName.slice(0, 7)}_${fourHex}`
      : `${node.longName}_${fourHex}`;
  }
  return `!${nodeNum.toString(16)}`;
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
