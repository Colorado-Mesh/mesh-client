/**
 * Store & Forward module side effects driven by the `PacketRouter`
 * `meshtastic_store_forward` event.
 *
 * `MeshtasticProtocol` forwards the raw S&F packet, so the runtime no longer
 * needs its own `device.events.onStoreForwardPacket` subscription for the
 * heartbeat tracking, auto history request, and replayed-text ingest below.
 *
 * Failure point: replayed history text is written straight to `messageStore` +
 * SQLite because it is not a Protocol chat event. A failed DB write is logged
 * and leaves the in-memory row intact; a missed heartbeat only delays the next
 * automatic history request until the following heartbeat.
 */
import type { Dispatch, SetStateAction } from 'react';

import { addMessage } from '../../stores/messageStore';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { errLikeToLogString } from '../errLikeToLogString';
import { getIdentityChatMessages } from '../identityStoreReads';
import {
  decodeStoreForwardTextPayload,
  isDuplicateHistoryMessage,
  parseStoreForwardHeartbeat,
} from '../meshtasticBacklogUtils';
import type { DomainEvent } from '../protocols/Protocol';
import { chatMessageToMessageRecord } from '../storeRecordAdapters';
import type { ChatMessage, IdentityId } from '../types';

const MAX_STORE_FORWARD_MESSAGES_PER_NODE = 50;

export interface MeshtasticStoreForwardSideEffectsDeps {
  touchLastData: () => void;
  getNodeName: (nodeNum: number) => string;
  /** False until the radio finishes configure — auto history must not race it. */
  getIsDeviceConfigured: () => boolean;
  /** Last seen router heartbeat, used by the manual Chat catch-up control. */
  recordHeartbeat: (info: { serverNodeId: number; channel: number; period: number }) => void;
  requestStoreForwardHistory: (options: { serverNodeId: number; manual: boolean }) => void;
  setStoreForwardMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
}

type StoreForwardDomainEvent = Extract<DomainEvent, { type: 'meshtastic_store_forward' }>;

function storeForwardBytes(raw: unknown): Uint8Array | null {
  const data = (raw as { data?: unknown } | null | undefined)?.data;
  return data instanceof Uint8Array ? data : null;
}

function appendReplayedHistoryText(identityId: IdentityId, chat: ChatMessage): void {
  if (isDuplicateHistoryMessage(getIdentityChatMessages(identityId), chat)) return;
  addMessage(identityId, chatMessageToMessageRecord(chat));
  void window.electronAPI.db.saveMessage(chat).catch((e: unknown) => {
    console.debug(
      '[meshtasticStoreForwardSideEffects] saveMessage failed ' + errLikeToLogString(e),
    );
  });
}

function handleStoreForward(
  identityId: IdentityId,
  event: StoreForwardDomainEvent['payload'],
  deps: MeshtasticStoreForwardSideEffectsDeps,
): void {
  deps.touchLastData();
  const data = storeForwardBytes(event.raw);
  if (!data) return;

  const from = event.from;
  const timestamp = event.timestamp;
  deps.setStoreForwardMessages((prev) => {
    const updated = new Map(prev);
    const existing = updated.get(from) ?? [];
    updated.set(from, [
      ...existing.slice(-MAX_STORE_FORWARD_MESSAGES_PER_NODE),
      { from, data, timestamp },
    ]);
    return updated;
  });

  const heartbeat = parseStoreForwardHeartbeat(data);
  if (from && heartbeat) {
    deps.recordHeartbeat({ serverNodeId: from, channel: event.channel, period: heartbeat.period });
    // secondary === 0 marks the primary router; only it replays chat history.
    if (heartbeat.secondary === 0 && deps.getIsDeviceConfigured()) {
      deps.requestStoreForwardHistory({ serverNodeId: from, manual: false });
    }
  }

  const payloadText = decodeStoreForwardTextPayload(data);
  if (!from || !payloadText) return;
  appendReplayedHistoryText(identityId, {
    sender_id: from,
    sender_name: deps.getNodeName(from),
    payload: payloadText,
    channel: event.channel,
    timestamp: Date.now(),
    isHistory: true,
    receivedVia: 'rf',
    viaStoreForward: true,
  });
}

/** Attach Store & Forward side effects for one Meshtastic identity. */
export function attachMeshtasticStoreForwardSideEffects(
  identityId: IdentityId,
  deps: MeshtasticStoreForwardSideEffectsDeps,
): () => void {
  const listener: PacketRouterListener = (event, routedIdentityId) => {
    if (routedIdentityId !== identityId || event.type !== 'meshtastic_store_forward') return;
    handleStoreForward(identityId, event.payload, deps);
  };
  return packetRouter.addListener(listener);
}
