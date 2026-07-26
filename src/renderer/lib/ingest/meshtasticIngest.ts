/**
 * Post-`PacketRouter` Meshtastic side effects: SQLite persistence and cross-transport dedup.
 *
 * Failure point: DB IPC errors — logged via caller; store state remains authoritative.
 * Fallback: skip DB write; UI still updates from Zustand.
 */
import { getConnection } from '../../stores/connectionStore';
import { upsertMessage, useMessageStore } from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { errLikeToLogString } from '../errLikeToLogString';
import { meshcoreHwModelIsContactTypeLabel } from '../meshcoreUtils';
import { ensureMeshtasticChatSenderInNodeStore } from '../meshtastic/meshtasticChatSenderNode';
import {
  findMeshtasticCrossTransportDuplicate,
  mapMeshtasticCrossTransportUpgrade,
  meshtasticPacketDedupKey,
  meshtasticPacketIdsEqual,
  normalizeMeshtasticPacketId,
} from '../meshtasticMessageDedup';
import type { DomainEvent } from '../protocols/Protocol';
import {
  chatMessageToMessageRecord,
  messageRecordsToChatMessages,
  messageRecordToChatMessage,
  nodeRecordToMeshNode,
} from '../storeRecordAdapters';
import type { IdentityId } from '../types';

const SEEN_PACKET_TTL_MS = 10 * 60 * 1000;

export interface MeshtasticIngestOptions {
  getIsConfiguring: () => boolean;
  getMyNodeNum: () => number;
}

export interface MeshtasticIngestSession {
  detach: () => void;
  setConfiguring: (value: boolean) => void;
  /** Register a packet id as seen (e.g. after MQTT ingest) to suppress duplicate RF rows. */
  markPacketSeen: (senderId: number, packetId: number) => void;
  /** Shared RF/MQTT duplicate check and mark for this identity. */
  isDuplicatePacket: (senderId: number, packetId: number) => boolean;
}

function pruneSeenPackets(seen: Map<string, number>, now: number): void {
  for (const [key, ts] of seen) {
    if (now - ts > SEEN_PACKET_TTL_MS) seen.delete(key);
  }
}

/** Packet ids may collide across different senders — dedup key is always sender-scoped. */
function isPacketSeen(seen: Map<string, number>, senderId: number, packetId: number): boolean {
  const now = Date.now();
  pruneSeenPackets(seen, now);
  const key = meshtasticPacketDedupKey(senderId, packetId);
  const ts = seen.get(key);
  if (ts != null && now - ts <= SEEN_PACKET_TTL_MS) return true;
  seen.set(key, now);
  return false;
}

function listChatMessages(identityId: IdentityId) {
  const byId = useMessageStore.getState().messages[identityId] ?? {};
  return messageRecordsToChatMessages(Object.values(byId));
}

function persistNode(identityId: IdentityId, nodeId: number): void {
  const record = useNodeStore.getState().nodes[identityId]?.[nodeId];
  if (!record) return;
  const meshNode = nodeRecordToMeshNode(record);
  if (meshcoreHwModelIsContactTypeLabel(meshNode.hw_model)) return;
  void window.electronAPI.db.saveNode(meshNode).catch((e: unknown) => {
    console.debug('[meshtasticIngest] saveNode failed ' + errLikeToLogString(e));
  });
}

function handleTextMessage(
  identityId: IdentityId,
  event: Extract<DomainEvent, { type: 'text_message' }>,
  seenPacketIds: Map<string, number>,
  options: MeshtasticIngestOptions,
): void {
  if (options.getIsConfiguring()) return;

  ensureMeshtasticChatSenderInNodeStore(identityId, event.payload.from, {
    lastHeardAt: event.payload.timestamp,
    source: 'rf',
  });
  persistNode(identityId, event.payload.from);

  const record = useMessageStore.getState().messages[identityId]?.[event.payload.id];
  if (!record) return;

  const incoming = messageRecordToChatMessage(record);
  const myNodeNum = options.getMyNodeNum() || getConnection(identityId)?.myNodeNum || 0;
  const isEcho = incoming.sender_id === myNodeNum;

  if (isEcho) {
    // Outbound RF uses useSendMessage (optimistic row + updateMessagePacketId). Saving the
    // echo here races and leaves a stale temp packet_id row in SQLite (restart duplicates).
    if (record.status === 'sending') {
      return;
    }
    void window.electronAPI.db.saveMessage(incoming).catch((e: unknown) => {
      console.debug('[meshtasticIngest] saveMessage echo failed ' + errLikeToLogString(e));
    });
    return;
  }

  const packetId = normalizeMeshtasticPacketId(incoming.packetId);
  const messages = listChatMessages(identityId);

  if (packetId != null && packetId !== 0 && !incoming.emoji) {
    // Packet ids may collide across different senders — always scope the match to the
    // same sender, mirroring `meshtasticPacketDedupKey` used by useMeshtasticRuntime.
    const isSamePacket = (m: (typeof messages)[number]): boolean =>
      meshtasticPacketIdsEqual(m.packetId, packetId) && m.sender_id === incoming.sender_id;
    const alreadySeen = messages.some(
      (m) => isSamePacket(m) && m.receivedVia != null && m.receivedVia !== 'rf',
    );
    if (alreadySeen || isPacketSeen(seenPacketIds, incoming.sender_id, packetId)) {
      const upgraded = messages.map((m) =>
        isSamePacket(m) && m.receivedVia === 'mqtt'
          ? { ...m, receivedVia: 'both' as const, rxHops: m.rxHops ?? incoming.rxHops }
          : m,
      );
      for (const m of upgraded) {
        if (isSamePacket(m) && m.receivedVia === 'both') {
          upsertMessage(identityId, chatMessageToMessageRecord(m));
        }
      }
      void window.electronAPI.db
        .updateMessageReceivedVia(packetId, incoming.rxHops)
        .catch((e: unknown) => {
          console.debug(
            '[meshtasticIngest] updateMessageReceivedVia failed ' + errLikeToLogString(e),
          );
        });
      return;
    }
  }

  if (!incoming.emoji) {
    const crossDup = findMeshtasticCrossTransportDuplicate(messages, incoming);
    if (crossDup) {
      const {
        messages: next,
        matched,
        packetIdForDb,
      } = mapMeshtasticCrossTransportUpgrade(messages, incoming);
      if (matched) {
        for (const m of next) {
          if (m.receivedVia === 'both') {
            upsertMessage(identityId, chatMessageToMessageRecord(m));
          }
        }
        if (packetIdForDb != null && packetIdForDb !== 0) {
          isPacketSeen(seenPacketIds, incoming.sender_id, packetIdForDb);
          void window.electronAPI.db
            .updateMessageReceivedVia(packetIdForDb, incoming.rxHops)
            .catch((e: unknown) => {
              console.debug(
                '[meshtasticIngest] cross-transport update failed ' + errLikeToLogString(e),
              );
            });
        }
        return;
      }
    }
  }

  void window.electronAPI.db.saveMessage(incoming).catch((e: unknown) => {
    console.debug('[meshtasticIngest] saveMessage failed ' + errLikeToLogString(e));
  });
}

function createListener(
  identityId: IdentityId,
  seenPacketIds: Map<string, number>,
  options: MeshtasticIngestOptions,
): PacketRouterListener {
  return (event, routedIdentityId) => {
    if (routedIdentityId !== identityId) return;
    switch (event.type) {
      case 'text_message':
        handleTextMessage(identityId, event, seenPacketIds, options);
        break;
      case 'node_info':
        persistNode(identityId, event.payload.nodeId);
        break;
      case 'position':
        persistNode(identityId, event.payload.nodeId);
        break;
      default:
        break;
    }
  };
}

/**
 * Attach post-router ingest for one Meshtastic identity. Call once per active transport.
 */
export function attachMeshtasticIngest(
  identityId: IdentityId,
  options: MeshtasticIngestOptions,
): MeshtasticIngestSession {
  const seenPacketIds = new Map<string, number>();
  let configuring = false;
  const opts: MeshtasticIngestOptions = {
    getIsConfiguring: () => configuring || options.getIsConfiguring(),
    getMyNodeNum: options.getMyNodeNum,
  };
  const detachListener = packetRouter.addListener(createListener(identityId, seenPacketIds, opts));
  return {
    detach: detachListener,
    setConfiguring: (value: boolean) => {
      configuring = value;
    },
    markPacketSeen: (senderId: number, packetId: number) => {
      if (packetId !== 0) isPacketSeen(seenPacketIds, senderId, packetId);
    },
    isDuplicatePacket: (senderId: number, packetId: number) =>
      packetId !== 0 && isPacketSeen(seenPacketIds, senderId, packetId),
  };
}
