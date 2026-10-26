import type { MeshProtocol } from '@/shared/meshProtocol';
import { isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';
import {
  isTakDmProtocol,
  TAK_DIRECT_PEERS_MAX,
  TAK_DM_PROTOCOLS,
  TAK_GEOCHAT_CALLSIGN_MAX_LEN,
  TAK_GEOCHAT_TEXT_MAX_LEN,
  type TakDirectPeer,
  type TakDmProtocol,
} from '@/shared/tak-types';

import { getConnection } from '../../stores/connectionStore';
import type { MessageRecord } from '../../stores/messageStore';
import { type NodeRecord, useNodeStore } from '../../stores/nodeStore';
import { reticulumHashForNodeId } from '../../stores/reticulumPeerStore';
import { getTakRadio } from '../../stores/takChannelStore';
import { getTakRelayPrefs, type TakRelayIdentityPrefs } from '../../stores/takRelayPrefsStore';
import { isTakSinkActive } from '../../stores/takSinkStore';
import { errLikeToLogString } from '../errLikeToLogString';
import { isMeshcoreDmExcludedHwModel } from '../meshcoreUtils';
import { resolveReticulumChatLxmfDestination } from '../reticulum/resolveReticulumChatLxmfDest';
import type { IdentityId, MeshNode } from '../types';
import { isFirstSeen } from './takSeenOnce';

/**
 * Whether a Reticulum peer's LXMF delivery destination is known under its own node id, so a
 * direct message to its marker goes to it and its replies come back from the same contact. A
 * peer whose LXMF address belongs to another destination (a telephony or bare identity hash
 * remapped) stays a plain marker.
 */
export function hasOwnLxmfDestination(nodeId: number): boolean {
  const hash = reticulumHashForNodeId(nodeId);
  if (!hash) return false;
  const resolved = resolveReticulumChatLxmfDestination(hash);
  return resolved.status === 'ok' && !resolved.remapped;
}

/**
 * Whether this app can send `node` a direct message on the radio TAK uses for `protocol`, by
 * the rule Chat and Rooms use: any other Meshtastic node; a MeshCore node that is not a
 * repeater, room server or sensor and whose public key this app holds; or a Reticulum peer
 * whose LXMF delivery destination is known. Main still checks the node is a companion and
 * that direct messages are on for the radio.
 */
export function canTakDirectMessage(node: MeshNode, protocol: MeshProtocol): boolean {
  if (!isTakDmProtocol(protocol) || node.node_id <= 0) return false;
  const identityId = getTakRadio(protocol);
  if (!identityId || node.node_id === getConnection(identityId)?.myNodeNum) return false;
  if (protocol === 'meshtastic') return !isMeshtasticBroadcastNodeNum(node.node_id);
  if (protocol === 'reticulum') return hasOwnLxmfDestination(node.node_id);
  return !isMeshcoreDmExcludedHwModel(node.hw_model) && hasMeshcoreContactKey(identityId, node);
}

/** MeshCore public keys are 32 bytes. */
const MESHCORE_PUBLIC_KEY_BYTES = 32;

/**
 * Whether this app holds a MeshCore node's public key, as a DM to it needs. MeshCore keeps
 * contact keys on the node record (`publicKey`), not on the map's MeshNode, which usually has
 * no `public_key_hex`; the node detail panel reads them the same way.
 */
function hasMeshcoreContactKey(identityId: IdentityId, node: MeshNode): boolean {
  if (node.public_key_hex?.trim()) return true;
  const nodes = useNodeStore.getState().nodes[identityId] as
    Record<number, NodeRecord | undefined> | undefined;
  const record = nodes?.[node.node_id];
  return (
    record?.publicKey?.length === MESHCORE_PUBLIC_KEY_BYTES || Boolean(record?.publicKeyHex?.trim())
  );
}

/** The protocols whose TAK radio has direct messages on, for main. */
export function listTakDmProtocols(
  radioByProtocol: Partial<Record<TakDmProtocol, IdentityId>>,
  prefsByIdentity: Record<IdentityId, TakRelayIdentityPrefs | undefined>,
): TakDmProtocol[] {
  return TAK_DM_PROTOCOLS.filter((p) => {
    const identityId = radioByProtocol[p];
    return identityId !== undefined && prefsByIdentity[identityId]?.directMessages === true;
  });
}

/** A retried copy of a direct message arrives within this long of the first. */
const RELAYED_DM_TTL_MS = 10 * 60 * 1000;
const RELAYED_DM_MAX = 256;
/** Direct messages already handed to TAK, by sender, send time and text, with when. */
const relayedDms = new Map<string, number>();

/**
 * True the first time a direct message is seen within the retry window. A sender that does not
 * hear its ack sends the same message again, with the same send time and text.
 */
function isFirstCopy(key: string, nowMs: number): boolean {
  return isFirstSeen(relayedDms, key, nowMs, RELAYED_DM_TTL_MS, RELAYED_DM_MAX);
}

/** Forget which direct messages were relayed; for tests. */
export function resetTakRelayedDirectMessages(): void {
  relayedDms.clear();
}

export interface TakHeardDirectMessage {
  /** The companion that sent it. */
  nodeId: number;
  /** Its name as heard. */
  senderName: string;
  text: string;
  timestampMs: number;
}

/**
 * Hand one heard direct message to TAK clients, when it reached the radio TAK uses for
 * `protocol` and that radio has direct messages on, unless it is a retried copy of one already
 * handed over. Main sends it to the TAK device that last wrote to the companion, or to all of
 * them. This direction never transmits on RF.
 */
export function relayDirectMessageToTak(
  identityId: IdentityId,
  protocol: TakDmProtocol,
  msg: TakHeardDirectMessage,
): void {
  if (!isTakSinkActive() || getTakRadio(protocol) !== identityId) return;
  if (!getTakRelayPrefs(identityId).directMessages) return;
  // A repeater's or room server's reply to a login or command is not a conversation.
  if (protocol === 'meshcore') {
    const nodes = useNodeStore.getState().nodes[identityId] as
      Record<number, NodeRecord | undefined> | undefined;
    if (isMeshcoreDmExcludedHwModel(nodes?.[msg.nodeId]?.hwModel)) return;
  }
  const text = msg.text.trim().slice(0, TAK_GEOCHAT_TEXT_MAX_LEN);
  if (!text || msg.nodeId <= 0) return;
  if (!isFirstCopy(`${protocol}:${msg.nodeId}:${msg.timestampMs}:${text}`, Date.now())) return;
  const senderCallsign =
    msg.senderName.trim().slice(0, TAK_GEOCHAT_CALLSIGN_MAX_LEN) || String(msg.nodeId);
  window.electronAPI.tak
    .pushDirectMessage({
      protocol,
      nodeId: msg.nodeId,
      senderCallsign,
      text,
      timeMs: msg.timestampMs,
    })
    .catch((e: unknown) => {
      console.warn('[TakDirectMessages] pushDirectMessage failed ' + errLikeToLogString(e));
    });
}

/**
 * The Reticulum peers this app has a direct conversation with, most recent first, for main: a
 * message sent to or heard from each, whether or not TAK was running then. Only peers whose
 * LXMF destination is known are listed, so each can be messaged from ATAK; one with no marker
 * gets a contact at 0, 0. A peer never messaged stays out of ATAK, however many are heard.
 */
export function listTakConversationPeers(
  messages: Record<string, MessageRecord> | undefined,
  nodes: Record<number, NodeRecord | undefined> | undefined,
  selfNodeId: number,
): TakDirectPeer[] {
  const lastMs = new Map<number, number>();
  for (const m of Object.values(messages ?? {})) {
    if (m.tapback) continue;
    const peer = (m.from === selfNodeId ? m.to : m.from) >>> 0;
    if (peer === 0 || peer === selfNodeId) continue;
    lastMs.set(peer, Math.max(lastMs.get(peer) ?? 0, m.timestamp));
  }
  const peers: TakDirectPeer[] = [];
  for (const [nodeId] of [...lastMs].sort((a, b) => b[1] - a[1])) {
    if (peers.length >= TAK_DIRECT_PEERS_MAX) break;
    if (!hasOwnLxmfDestination(nodeId)) continue;
    const node = nodes?.[nodeId];
    const name = node?.longName?.trim() || node?.shortName?.trim() || '';
    const callsign =
      name
        .replace(/\p{Cc}+/gu, ' ')
        .slice(0, TAK_GEOCHAT_CALLSIGN_MAX_LEN)
        .trim() || String(nodeId);
    peers.push({ protocol: 'reticulum', nodeId, callsign });
  }
  return peers;
}
