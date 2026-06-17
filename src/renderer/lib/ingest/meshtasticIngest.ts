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
  markPacketSeen: (packetId: number) => void;
}

function pruneSeenPackets(seen: Map<number, number>, now: number): void {
  for (const [id, ts] of seen) {
    if (now - ts > SEEN_PACKET_TTL_MS) seen.delete(id);
  }
}

function isPacketSeen(seen: Map<number, number>, packetId: number): boolean {
  const now = Date.now();
  pruneSeenPackets(seen, now);
  const ts = seen.get(packetId);
  if (ts != null && now - ts <= SEEN_PACKET_TTL_MS) return true;
  seen.set(packetId, now);
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
  seenPacketIds: Map<number, number>,
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
    const alreadySeen = messages.some(
      (m) =>
        meshtasticPacketIdsEqual(m.packetId, packetId) &&
        m.receivedVia != null &&
        m.receivedVia !== 'rf',
    );
    if (alreadySeen || isPacketSeen(seenPacketIds, packetId)) {
      const upgraded = messages.map((m) =>
        meshtasticPacketIdsEqual(m.packetId, packetId) && m.receivedVia === 'mqtt'
          ? { ...m, receivedVia: 'both' as const, rxHops: m.rxHops ?? incoming.rxHops }
          : m,
      );
      for (const m of upgraded) {
        if (meshtasticPacketIdsEqual(m.packetId, packetId) && m.receivedVia === 'both') {
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
          isPacketSeen(seenPacketIds, packetIdForDb);
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
  seenPacketIds: Map<number, number>,
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
  const seenPacketIds = new Map<number, number>();
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
    markPacketSeen: (packetId: number) => {
      if (packetId !== 0) isPacketSeen(seenPacketIds, packetId);
    },
  };
}
