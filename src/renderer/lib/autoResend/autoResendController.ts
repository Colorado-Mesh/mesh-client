import { create } from 'zustand';

import { isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';

import {
  deleteMessage,
  isGroupChannelRecord,
  type MessageRecord,
  subscribeMessageStoreEvents,
  useMessageStore,
} from '../../stores/messageStore';
import { omitRecordKey } from '../../stores/storeUtils';
import { errLikeToLogString } from '../errLikeToLogString';
import { tryParseMecp } from '../mecp/mecpMessages';
import { getRadioCapabilities } from '../radio/providerFactory';
import type { IdentityId, MeshProtocol } from '../types';
import { autoResendDelayMs, REGULAR_MESSAGE_MAX_AUTO_RESENDS } from './autoResendPolicy';

/** A scheduled automatic resend of one failed bubble. */
export interface AutoResendEntry {
  identityId: IdentityId;
  protocol: MeshProtocol;
  messageId: string;
  /** Resend number this entry performs (1..{@link REGULAR_MESSAGE_MAX_AUTO_RESENDS}). */
  attempt: number;
  nextAt: number;
}

interface AutoResendState {
  /** Keyed by {@link autoResendKey}; drives the failed-bubble countdown + Cancel retry. */
  entries: Record<string, AutoResendEntry>;
}

export const useAutoResendStore = create<AutoResendState>()(() => ({ entries: {} }));

export function autoResendKey(protocol: MeshProtocol, messageId: string): string {
  return `${protocol}:${messageId}`;
}

/** Store id ChatPanel bubbles map to (mirrors `chatMessageToMessageRecord`). */
export function autoResendMessageId(msg: {
  storeId?: string;
  reticulum_message_hash?: string;
  packetId?: number;
}): string | null {
  return (
    msg.storeId ??
    msg.reticulum_message_hash ??
    (msg.packetId != null ? String(msg.packetId) : null)
  );
}

export type AutoResendSendFn = (
  protocol: MeshProtocol,
  args: {
    text: string;
    channelIndex: number;
    destination?: number;
    replyTo?: string;
    retryOfStoreId?: string;
  },
) => string | undefined;

interface TrackedOutbound {
  identityId: IdentityId;
  protocol: MeshProtocol;
  /** Automatic resends already spent on this message's lineage. */
  resendsUsed: number;
}

/** Bound on tracked session sends; oldest are dropped first (Map insertion order). */
const MAX_TRACKED_OUTBOUND = 500;

const tracked = new Map<string, TrackedOutbound>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let sendFn: AutoResendSendFn | null = null;
let resolveProtocol: (identityId: IdentityId) => MeshProtocol | null = () => null;

function trackOutbound(key: string, value: TrackedOutbound): void {
  if (tracked.size >= MAX_TRACKED_OUTBOUND && !tracked.has(key)) {
    const oldest = tracked.keys().next();
    if (!oldest.done) tracked.delete(oldest.value);
  }
  tracked.set(key, value);
}

function clearEntry(key: string): void {
  const timer = timers.get(key);
  if (timer != null) clearTimeout(timer);
  timers.delete(key);
  useAutoResendStore.setState((s) => {
    if (!Object.hasOwn(s.entries, key)) return s;
    return { entries: omitRecordKey(s.entries, key) };
  });
}

/**
 * Regular own sends only: MECP has its own until-acknowledged outbox retry; tapbacks and
 * channel floods without a failing delivery signal (MeshCore) are skipped.
 */
export function isAutoResendEligible(protocol: MeshProtocol, record: MessageRecord): boolean {
  if (record.tapback) return false;
  if (record.roomServerId != null) return false;
  if (tryParseMecp(record.payload) != null) return false;
  if (isGroupChannelRecord(record) && !getRadioCapabilities(protocol).hasChannelDeliveryAck) {
    return false;
  }
  return true;
}

function recordFor(identityId: IdentityId, messageId: string): MessageRecord | undefined {
  const bucket = useMessageStore.getState().messages[identityId] as
    Record<string, MessageRecord> | undefined;
  return bucket?.[messageId];
}

function resendArgsFor(record: MessageRecord): Parameters<AutoResendSendFn>[1] {
  const isChannel = isGroupChannelRecord(record) || isMeshtasticBroadcastNodeNum(record.to);
  return {
    text: record.payload,
    channelIndex: record.channelIndex,
    ...(isChannel ? {} : { destination: record.to }),
    ...(record.replyTo != null ? { replyTo: record.replyTo } : {}),
    retryOfStoreId: record.id,
  };
}

/** Drop the superseded failed bubble. */
function removeSupersededBubble(protocol: MeshProtocol, identityId: IdentityId, id: string): void {
  deleteMessage(identityId, id);
  const packetId = Number(id);
  if (!Number.isInteger(packetId) || packetId < 0) return;
  void window.electronAPI.db
    .deleteFailedOutboundMessage(protocol, packetId >>> 0)
    .catch((err: unknown) => {
      console.warn('[autoResend] delete superseded failed row ' + errLikeToLogString(err));
    });
}

function fireResend(key: string): void {
  const entry = useAutoResendStore.getState().entries[key] as AutoResendEntry | undefined;
  clearEntry(key);
  if (!entry || !sendFn) return;
  const record = recordFor(entry.identityId, entry.messageId);
  // Superseded meanwhile (manual Resend, Reticulum announce resend, late ACK).
  if (record?.status !== 'failed') return;
  tracked.delete(key);
  let newId: string | undefined;
  try {
    newId = sendFn(entry.protocol, resendArgsFor(record));
  } catch (err: unknown) {
    console.warn('[autoResend] resend failed to start ' + errLikeToLogString(err));
    return;
  }
  if (newId == null || newId === '') return;
  trackOutbound(autoResendKey(entry.protocol, newId), {
    identityId: entry.identityId,
    protocol: entry.protocol,
    resendsUsed: entry.attempt,
  });
  if (newId !== entry.messageId) {
    removeSupersededBubble(entry.protocol, entry.identityId, entry.messageId);
  }
}

function schedule(key: string, info: TrackedOutbound, messageId: string, now: number): void {
  const attempt = info.resendsUsed + 1;
  const nextAt = now + autoResendDelayMs(attempt);
  useAutoResendStore.setState((s) => ({
    entries: {
      ...s.entries,
      [key]: { identityId: info.identityId, protocol: info.protocol, messageId, attempt, nextAt },
    },
  }));
  timers.set(
    key,
    setTimeout(() => {
      fireResend(key);
    }, nextAt - now),
  );
}

/** Re-check tracked session sends (O(tracked), not O(messages)). */
export function evaluateTrackedOutbound(now: number = Date.now()): void {
  const entries = useAutoResendStore.getState().entries;
  for (const [key, info] of [...tracked]) {
    const messageId = key.slice(info.protocol.length + 1);
    const record = recordFor(info.identityId, messageId);
    if (!record) continue;
    if (record.status === 'acked') {
      tracked.delete(key);
      clearEntry(key);
      continue;
    }
    if (record.status !== 'failed' || Object.hasOwn(entries, key)) continue;
    if (info.resendsUsed >= REGULAR_MESSAGE_MAX_AUTO_RESENDS) {
      tracked.delete(key);
      continue;
    }
    schedule(key, info, messageId, now);
  }
}

/** Stop the pending automatic resend; manual Resend stays available. */
export function cancelAutoResend(protocol: MeshProtocol, messageId: string): void {
  const key = autoResendKey(protocol, messageId);
  clearEntry(key);
  tracked.delete(key);
}

function onRenamed(identityId: IdentityId, fromId: string, toId: string): void {
  const protocol = resolveProtocol(identityId);
  if (protocol == null) return;
  const fromKey = autoResendKey(protocol, fromId);
  const info = tracked.get(fromKey);
  if (!info) return;
  tracked.delete(fromKey);
  const entry = useAutoResendStore.getState().entries[fromKey] as AutoResendEntry | undefined;
  clearEntry(fromKey);
  trackOutbound(autoResendKey(protocol, toId), info);
  if (entry) evaluateTrackedOutbound();
}

/**
 * Start watching own sends for failures. `send` issues a resend and returns the new store id;
 * `protocolOf` maps an identity to its protocol. Returns a teardown.
 */
export function startAutoResend(
  send: AutoResendSendFn,
  protocolOf: (identityId: IdentityId) => MeshProtocol | null,
): () => void {
  sendFn = send;
  resolveProtocol = protocolOf;
  const unsubEvents = subscribeMessageStoreEvents((event) => {
    if (event.type === 'renamed') {
      onRenamed(event.identityId, event.fromId, event.toId);
      return;
    }
    const record = event.record;
    if (record.status !== 'sending') return;
    const protocol = protocolOf(event.identityId);
    if (protocol == null || !isAutoResendEligible(protocol, record)) return;
    const key = autoResendKey(protocol, record.id);
    if (!tracked.has(key)) {
      trackOutbound(key, { identityId: event.identityId, protocol, resendsUsed: 0 });
    }
  });
  const unsubStore = useMessageStore.subscribe(() => {
    if (tracked.size > 0) evaluateTrackedOutbound();
  });
  return () => {
    unsubEvents();
    unsubStore();
    sendFn = null;
  };
}

/** Test seam: drop all tracked sends, timers, and entries. */
export function resetAutoResendForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  tracked.clear();
  sendFn = null;
  resolveProtocol = () => null;
  useAutoResendStore.setState({ entries: {} });
}
