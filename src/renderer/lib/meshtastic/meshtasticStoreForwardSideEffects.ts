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
import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import { createPacketDedupeRegistry } from '../drivers/packetDedupeRegistry';
import { errLikeToLogString } from '../errLikeToLogString';
import { getIdentityChatMessages } from '../identityStoreReads';
import {
  decodeStoreForwardTextPayload,
  isDuplicateHistoryMessage,
  parseStoreForwardHeartbeat,
} from '../meshtasticBacklogUtils';
import { toPacketPayloadBytes } from '../packetPayload';
import type { DomainEvent } from '../protocols/Protocol';
import { appendToRingMap } from '../sessionMemoryCaps';
import { chatMessageToMessageRecord } from '../storeRecordAdapters';
import type { ChatMessage, IdentityId } from '../types';

const MAX_STORE_FORWARD_MESSAGES_PER_NODE = 50;

/**
 * Routers repeat heartbeats and can re-send the same history frame on retry.
 * Identical bytes from the same node inside this window are dropped before they
 * reach the ring buffer, the auto-history trigger, and the text replay path.
 */
const STORE_FORWARD_DEDUPE_TTL_MS = 60_000;
const STORE_FORWARD_DEDUPE_MAX_ENTRIES = 256;

/**
 * Local floor between automatic history requests per router. `requestStoreForwardHistory`
 * applies the user-facing cooldown (see `meshtasticBacklogUtils`); this only
 * stops a heartbeat burst from queueing several requests before that runs.
 */
const AUTO_HISTORY_MIN_INTERVAL_MS = 60_000;

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
  const bytes = toPacketPayloadBytes(data);
  return bytes.length > 0 ? bytes : null;
}

/** Content identity for one S&F frame: sender plus length-prefixed payload bytes. */
function storeForwardDedupeKey(from: number, data: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of data) {
    hash = Math.imul(hash ^ byte, 16777619);
  }
  return `${from}:${data.length}:${(hash >>> 0).toString(16)}`;
}

/** Per-router timestamps for the local auto-history floor. */
type AutoHistoryGate = Map<number, number>;

function shouldRequestAutoHistory(gate: AutoHistoryGate, serverNodeId: number, now: number) {
  const lastAt = gate.get(serverNodeId);
  if (lastAt !== undefined && now - lastAt < AUTO_HISTORY_MIN_INTERVAL_MS) return false;
  gate.set(serverNodeId, now);
  return true;
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

interface StoreForwardSessionState {
  seenFrames: ReturnType<typeof createPacketDedupeRegistry>;
  autoHistoryGate: AutoHistoryGate;
}

function handleStoreForward(
  identityId: IdentityId,
  event: StoreForwardDomainEvent['payload'],
  deps: MeshtasticStoreForwardSideEffectsDeps,
  session: StoreForwardSessionState,
): void {
  deps.touchLastData();
  const data = storeForwardBytes(event.raw);
  if (!data) return;

  const from = event.from;
  const timestamp = event.timestamp;
  // Heartbeat bookkeeping stays outside the dedupe: identical periodic frames
  // are exactly how the Chat catch-up control learns the router is still alive.
  const isRetransmit = session.seenFrames.markSeen(storeForwardDedupeKey(from, data));

  if (!isRetransmit) {
    deps.setStoreForwardMessages((prev) =>
      appendToRingMap(prev, from, { from, data, timestamp }, MAX_STORE_FORWARD_MESSAGES_PER_NODE),
    );
  }

  const heartbeat = parseStoreForwardHeartbeat(data);
  if (from && heartbeat) {
    deps.recordHeartbeat({ serverNodeId: from, channel: event.channel, period: heartbeat.period });
    // secondary === 0 marks the primary router; only it replays chat history.
    if (
      heartbeat.secondary === 0 &&
      deps.getIsDeviceConfigured() &&
      shouldRequestAutoHistory(session.autoHistoryGate, from, Date.now())
    ) {
      deps.requestStoreForwardHistory({ serverNodeId: from, manual: false });
    }
  }

  if (isRetransmit) return;
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
  const session: StoreForwardSessionState = {
    seenFrames: createPacketDedupeRegistry({
      ttlMs: STORE_FORWARD_DEDUPE_TTL_MS,
      maxEntries: STORE_FORWARD_DEDUPE_MAX_ENTRIES,
    }),
    autoHistoryGate: new Map(),
  };
  return attachTypedPacketListener(identityId, 'meshtastic_store_forward', (payload) => {
    handleStoreForward(identityId, payload, deps, session);
  });
}
