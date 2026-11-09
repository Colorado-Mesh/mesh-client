/**
 * Names and wording for a captured message route (Chat hop pill tooltip). Runs on hover/focus
 * only. The capture lookups are in `chatMessageRoute.ts`.
 */
import type { NodeHashCandidate } from '../../shared/meshcoreNodeHash';
import { formatMeshtasticNodeId } from '../../shared/nodeNameUtils';
import type { ChatMessageRouteLookup, ChatMessageRouteUnavailableReason } from './chatMessageRoute';
import {
  isMeshcoreHeardRepeatRole,
  listMeshcorePathPrefixMatches,
} from './meshcore/heardRepeatTracker';
import { getMeshcorePubKey } from './meshcore/meshcorePubKeyRegistry';
import type { MessageRouteDetail } from './radio/BaseRadioProvider';
import type { MeshNode } from './types';

/** One relay on the route, with the contact it most likely is. */
export interface ChatRouteHop {
  /** On-air identifier as shown elsewhere in the app (MeshCore path hash, Meshtastic byte). */
  hash: string;
  /** Freshest matching node's name, or its id when it has none; null when no node matches. */
  name: string | null;
  /** Known nodes sharing this identifier (0 = none, more than 1 = ambiguous). */
  matchCount: number;
}

export type ChatMessageRouteView =
  | { kind: 'floodPath'; hops: ChatRouteHop[] }
  | { kind: 'lastRelay'; relay: ChatRouteHop }
  | { kind: 'unavailable'; reason: ChatMessageRouteUnavailableReason };

function nodeName(node: MeshNode | undefined): string | null {
  if (!node) return null;
  // Rows hydrated from older databases can still lack names despite the declared type.
  const { long_name: longName, short_name: shortName } = node as {
    long_name?: string | null;
    short_name?: string | null;
  };
  const name = longName?.trim() || shortName?.trim();
  return name ? name : null;
}

function bytesFromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function publicKeyFromHex(hex: string | null | undefined): Uint8Array | undefined {
  if (hex?.length !== 64) return undefined;
  return bytesFromHex(hex) ?? undefined;
}

export interface ResolveMeshcoreRouteOpts {
  myNodeNum?: number;
  /** Defaults to the live MeshCore pubkey registry (MeshNode often omits `public_key_hex`). */
  getPubKey?: (nodeId: number) => Uint8Array | undefined;
}

/**
 * Name each MeshCore path hash. Only Repeater/Room contacts with a known public key are
 * candidates: companions do not forward floods, and matching a 1-byte hash without the key
 * would fall back to an XOR-fold of the node id, which is not the on-air hash.
 */
export function resolveMeshcoreRouteHops(
  hashes: readonly string[],
  nodes: ReadonlyMap<number, MeshNode>,
  opts: ResolveMeshcoreRouteOpts = {},
): ChatRouteHop[] {
  const getPubKey = opts.getPubKey ?? getMeshcorePubKey;
  const candidates: NodeHashCandidate[] = [];
  const pubKeyByNodeId = new Map<number, Uint8Array>();
  for (const [nodeId, node] of nodes) {
    if (nodeId === opts.myNodeNum || !isMeshcoreHeardRepeatRole(node.hw_model)) continue;
    const key = getPubKey(nodeId) ?? publicKeyFromHex(node.public_key_hex);
    if (!key) continue;
    candidates.push({ node_id: nodeId, last_heard: node.last_heard });
    pubKeyByNodeId.set(nodeId, key);
  }
  return hashes.map((hash) => {
    const bytes = bytesFromHex(hash);
    const matches = bytes ? listMeshcorePathPrefixMatches(bytes, candidates, pubKeyByNodeId) : [];
    const freshest = matches.at(0);
    return {
      hash,
      // Same id fallback as the raw packet log's path labels.
      name:
        freshest != null ? (nodeName(nodes.get(freshest)) ?? `0x${freshest.toString(16)}`) : null,
      matchCount: matches.length,
    };
  });
}

/**
 * Name a Meshtastic relay byte. The last relay transmitted straight to our radio, so a match
 * heard at 0 hops is preferred over other nodes that share the byte.
 */
export function resolveMeshtasticRelay(
  relayByte: number,
  nodes: ReadonlyMap<number, MeshNode>,
  opts: { myNodeNum?: number; senderId?: number } = {},
): ChatRouteHop {
  const matches: MeshNode[] = [];
  for (const [nodeId, node] of nodes) {
    if (nodeId === opts.myNodeNum || nodeId === opts.senderId) continue;
    if ((nodeId & 0xff) === relayByte) matches.push(node);
  }
  const direct = matches.filter((node) => node.hops_away === 0);
  const pool = (direct.length > 0 ? direct : matches).toSorted(
    (a, b) => b.last_heard - a.last_heard,
  );
  const best = pool.at(0);
  return {
    hash: relayByte.toString(16).padStart(2, '0'),
    // A node heard before its NodeInfo has no name yet; show its id as Chat does.
    name: best ? (nodeName(best) ?? formatMeshtasticNodeId(best.node_id)) : null,
    matchCount: matches.length,
  };
}

/** Resolve names for a lookup result. */
export function buildChatMessageRouteView(
  lookup: ChatMessageRouteLookup,
  nodes: ReadonlyMap<number, MeshNode>,
  opts: { myNodeNum?: number; senderId?: number } = {},
): ChatMessageRouteView {
  switch (lookup.status) {
    case 'floodPath':
      return {
        kind: 'floodPath',
        hops: resolveMeshcoreRouteHops(lookup.hashes, nodes, { myNodeNum: opts.myNodeNum }),
      };
    case 'lastRelay':
      return { kind: 'lastRelay', relay: resolveMeshtasticRelay(lookup.relayByte, nodes, opts) };
    case 'unavailable':
      return { kind: 'unavailable', reason: lookup.reason };
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface ChatMessageRouteTooltipInput {
  hops: number;
  senderName: string;
  routeDetail: MessageRouteDetail;
  view?: ChatMessageRouteView;
  /** Late RF correction mark is active on this pill. */
  refined?: boolean;
}

function hopLine(t: Translate, index: number, hop: ChatRouteHop): string {
  if (hop.name == null) return t('chatPanel.messageRoute.hopUnknown', { index, hash: hop.hash });
  if (hop.matchCount > 1) {
    return t('chatPanel.messageRoute.hopGuess', { index, name: hop.name, hash: hop.hash });
  }
  return t('chatPanel.messageRoute.hopNamed', { index, name: hop.name, hash: hop.hash });
}

function lastRelayLine(t: Translate, relay: ChatRouteHop): string {
  if (relay.name == null) return t('chatPanel.messageRoute.lastRelayUnknown', { hash: relay.hash });
  if (relay.matchCount > 1) {
    return t('chatPanel.messageRoute.lastRelayGuess', { name: relay.name, hash: relay.hash });
  }
  return t('chatPanel.messageRoute.lastRelayNamed', { name: relay.name });
}

function unavailableLine(t: Translate, reason: ChatMessageRouteUnavailableReason): string {
  switch (reason) {
    case 'directOrRoomMessage':
      return t('chatPanel.messageRoute.unavailableDirectOrRoom');
    case 'notCaptured':
      return t('chatPanel.messageRoute.unavailableNotCaptured');
    case 'relayNotReported':
      return t('chatPanel.messageRoute.relayNotReported');
  }
}

/** Tooltip text, one fact per line (the instant tooltip bubble keeps line breaks). */
export function formatChatMessageRouteTooltip(
  t: Translate,
  input: ChatMessageRouteTooltipInput,
): string {
  const sender = input.senderName.trim() || t('common.unknown');
  const view = input.view;
  // The capture is matched by content, so its path length outranks a stored count that a
  // time-window correction may have taken from a neighbouring packet.
  const hops =
    input.routeDetail === 'floodPath' && view?.kind === 'floodPath' ? view.hops.length : input.hops;
  const lines: string[] = [];
  if (hops <= 0) {
    lines.push(t('chatPanel.messageRoute.receivedDirect', { name: sender }));
  } else {
    lines.push(t('chatPanel.messageRoute.reachedYouInHops', { count: hops }));
    if (input.routeDetail === 'none') {
      lines.push(t('chatPanel.messageRoute.notRecorded'));
    } else if (view?.kind === 'floodPath') {
      lines.push(t('chatPanel.messageRoute.from', { name: sender }));
      view.hops.forEach((hop, i) => {
        lines.push(hopLine(t, i + 1, hop));
      });
      lines.push(t('chatPanel.messageRoute.toYou'));
    } else if (view?.kind === 'lastRelay') {
      lines.push(lastRelayLine(t, view.relay));
      lines.push(t('chatPanel.messageRoute.lastRelayOnly'));
    } else {
      lines.push(unavailableLine(t, view?.kind === 'unavailable' ? view.reason : 'notCaptured'));
    }
  }
  if (input.refined) lines.push(t('chatPanel.hopCountRefinedFromRf'));
  return lines.join('\n');
}
