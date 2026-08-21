import { create } from 'zustand';

import type { ReticulumDeliveryMethod } from '@/shared/reticulumDeliveryMethod';

import {
  clearHeardRepeatWindowIfMessage,
  renameHeardRepeatWindowMessageId,
} from '../lib/meshcore/heardRepeatTracker';
import { useRelayCoverageStore } from '../lib/relayCoverage/relayCoverageStore';
import type { IdentityId } from '../lib/types';
import { omitRecordKey } from './storeUtils';

export type MessageStatus = 'sending' | 'acked' | 'failed';

/**
 * Transport markers. Reticulum multi-egress uses `+`-joined atoms (e.g. `rf+tcp`).
 * Meshtastic hybrid RF+MQTT remains `both`.
 */
export type MessageTransport =
  | 'rf'
  | 'ble'
  | 'mqtt'
  | 'both'
  | 'tcp'
  | 'network'
  | 'paper'
  | `${'rf' | 'ble' | 'tcp' | 'network'}+${string}`;

export interface MessageRecord {
  id: string;
  from: number;
  senderName?: string;
  to: number;
  payload: string;
  channelIndex: number;
  timestamp: number;
  rxSnr?: number;
  rxRssi?: number;
  hopCount?: number;
  /** RF-derived hops away for this receive when known (Meshtastic hopStart−hopLimit; MeshCore path hops). */
  rxHops?: number;
  tapback?: boolean;
  replyTo?: string;
  replyPreviewText?: string;
  replyPreviewSender?: string;
  status?: MessageStatus;
  mqttStatus?: MessageStatus;
  receivedVia?: MessageTransport;
  isHistory?: boolean;
  error?: string;
  /** MeshCore room server posts (BBS); filters Rooms panel stream. */
  roomServerId?: number;
  /** Reticulum LXMF message hash (hex) for reply/reaction threading. */
  reticulumMessageHash?: string;
  /** Reticulum sender destination hash (hex). */
  reticulumSenderHash?: string;
  /** Reticulum reply target message hash (hex). */
  reticulumReplyToHash?: string;
  /** Reticulum LXMF delivery method when queued (direct / propagated / opportunistic / paper / stored_locally). */
  reticulumDeliveryMethod?: ReticulumDeliveryMethod;
  /** Sidecar outbound delivery_attempts (for triage dumps; optional). */
  reticulumDeliveryAttempts?: number;
  /** Saved attachment path on disk (local saves). */
  reticulumAttachmentPath?: string;
  /** Kind of inbound attachment saved at reticulumAttachmentPath. */
  reticulumAttachmentKind?: 'image' | 'audio';
  /** LXMF FIELD_AUDIO mode (16 = AM_OPUS_OGG). */
  reticulumAudioMode?: number;
  /** Estimated audio duration in seconds (decoded client-side; optional). */
  reticulumAudioDurationSec?: number;
  /** Message was replayed from a Store & Forward server (Meshtastic only). */
  viaStoreForward?: boolean;
}

interface MessageStoreState {
  messages: Record<IdentityId, Record<string, MessageRecord>>;
}

const defaultState: MessageStoreState = {
  messages: {},
};

export const useMessageStore = create<MessageStoreState>()(() => defaultState);

const MESSAGE_RECORD_KEYS: (keyof MessageRecord)[] = [
  'id',
  'from',
  'senderName',
  'to',
  'payload',
  'channelIndex',
  'timestamp',
  'rxSnr',
  'rxRssi',
  'hopCount',
  'rxHops',
  'tapback',
  'replyTo',
  'replyPreviewText',
  'replyPreviewSender',
  'status',
  'mqttStatus',
  'receivedVia',
  'isHistory',
  'error',
  'roomServerId',
  'reticulumMessageHash',
  'reticulumSenderHash',
  'reticulumReplyToHash',
  'reticulumDeliveryMethod',
  'reticulumDeliveryAttempts',
  'reticulumAttachmentPath',
  'reticulumAttachmentKind',
  'reticulumAudioMode',
  'reticulumAudioDurationSec',
  'viaStoreForward',
];

function messageRecordFieldsEqual(a: MessageRecord, b: MessageRecord): boolean {
  // MessageRecord fields are primitives (string/number/boolean/undefined); strict === is sufficient.
  for (const key of MESSAGE_RECORD_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function mergeIdentityMessages(
  state: MessageStoreState,
  identityId: IdentityId,
  nextBucket: Record<string, MessageRecord>,
): MessageStoreState {
  if (state.messages[identityId] === nextBucket) return state;
  return {
    messages: Object.assign({}, state.messages, { [identityId]: nextBucket }),
  };
}

/** Insert or replace the full record when fields differ (no merge). Use upsertMessage for partial updates. */
export function addMessage(identityId: IdentityId, message: MessageRecord): void {
  useMessageStore.setState((s) => {
    const byIdentity = s.messages[identityId] ?? {};
    const existing = byIdentity[message.id];
    if (existing === message || (existing && messageRecordFieldsEqual(existing, message))) {
      return s;
    }
    return mergeIdentityMessages(s, identityId, { ...byIdentity, [message.id]: message });
  });
}

/**
 * Replace-or-insert. Used by PacketRouter to dedupe outbound echo: when the
 * radio reports the just-sent packet with its real id, this overwrites the
 * optimistic row instead of creating a duplicate.
 */
export function upsertMessage(identityId: IdentityId, message: MessageRecord): void {
  useMessageStore.setState((s) => {
    const byIdentity = s.messages[identityId] ?? {};
    const existing = byIdentity[message.id];
    const merged = existing ? { ...existing, ...message } : message;
    if (existing && merged.to === 0 && existing.to != null && existing.to !== 0) {
      merged.to = existing.to;
    }
    if (existing === merged || (existing && messageRecordFieldsEqual(existing, merged))) {
      return s;
    }
    return mergeIdentityMessages(s, identityId, { ...byIdentity, [message.id]: merged });
  });
}

/** Single setState merge for many messages (startup / DB hydration). */
export function upsertMessageRecordsForIdentity(
  identityId: IdentityId,
  records: MessageRecord[],
): void {
  if (records.length === 0) return;
  useMessageStore.setState((s) => {
    const prior = s.messages[identityId] ?? {};
    const byIdentity = { ...prior };
    let changed = false;
    for (const message of records) {
      const existing = byIdentity[message.id];
      const merged = existing ? { ...existing, ...message } : message;
      if (existing && merged.to === 0 && existing.to != null && existing.to !== 0) {
        merged.to = existing.to;
      }
      if (existing === merged || (existing && messageRecordFieldsEqual(existing, merged))) {
        continue;
      }
      byIdentity[message.id] = merged;
      changed = true;
    }
    if (!changed) return s;
    return mergeIdentityMessages(s, identityId, byIdentity);
  });
}

/** Replace the full message bucket for an identity (post-delete DB reload). */
export function replaceMessageRecordsForIdentity(
  identityId: IdentityId,
  records: MessageRecord[],
): void {
  useMessageStore.setState((s) => {
    const byIdentity: Record<string, MessageRecord> = {};
    for (const message of records) {
      byIdentity[message.id] = message;
    }
    const prior = s.messages[identityId];
    if (prior && Object.keys(prior).length === records.length) {
      let idsMatch = true;
      for (const message of records) {
        if (!prior[message.id]) {
          idsMatch = false;
          break;
        }
      }
      if (idsMatch) {
        let identical = true;
        for (const message of records) {
          if (!messageRecordFieldsEqual(prior[message.id], message)) {
            identical = false;
            break;
          }
        }
        if (identical) return s;
      }
    }
    return mergeIdentityMessages(s, identityId, byIdentity);
  });
}

/**
 * Union DB snapshot into the in-memory bucket without dropping live rows that are
 * not yet persisted (connect-time race with fire-and-forget SQLite writes).
 * DB rows win on id collision when fields differ.
 */
export function mergeMessageRecordsFromDbForIdentity(
  identityId: IdentityId,
  records: MessageRecord[],
): void {
  useMessageStore.setState((s) => {
    const prior = s.messages[identityId] ?? {};
    const byIdentity: Record<string, MessageRecord> = { ...prior };
    let changed = false;
    for (const message of records) {
      const existing = byIdentity[message.id];
      if (!existing) {
        byIdentity[message.id] = message;
        changed = true;
        continue;
      }
      if (!messageRecordFieldsEqual(existing, message)) {
        byIdentity[message.id] = message;
        changed = true;
      }
    }
    if (!changed) return s;
    return mergeIdentityMessages(s, identityId, byIdentity);
  });
}

/** Remove all store messages matching a cleared SQLite channel index. */
export function pruneMessageRecordsForIdentityByChannel(
  identityId: IdentityId,
  channel: number,
): void {
  useMessageStore.setState((s) => {
    const byIdentity = s.messages[identityId];
    if (!byIdentity) return s;
    const next: Record<string, MessageRecord> = {};
    let removed = false;
    for (const [id, message] of Object.entries(byIdentity)) {
      if (message.channelIndex === channel) {
        removed = true;
        continue;
      }
      next[id] = message;
    }
    if (!removed) return s;
    return mergeIdentityMessages(s, identityId, next);
  });
}

/**
 * Re-key a message (used when the optimistic provisional id is replaced by the
 * SDK-assigned packetId on send completion).
 *
 * When `toId` already holds a Completes (`acked`) row, keep that row and drop
 * `fromId` instead of overwriting — Reticulum retries must not turn an unrelated
 * delivered bubble into ⏳ via hash collision / rename races.
 */
export function renameMessageId(identityId: IdentityId, fromId: string, toId: string): void {
  const before = useMessageStore.getState().messages[identityId];
  const fromExisting = before?.[fromId];
  const dropOntoAckedCompletes =
    fromId !== toId && fromExisting != null && before?.[toId]?.status === 'acked';

  useMessageStore.setState((s) => {
    const byIdentity = s.messages[identityId];
    const existing = byIdentity?.[fromId];
    if (!existing) return s;
    if (fromId === toId) {
      const updated = { ...existing, id: toId };
      if (messageRecordFieldsEqual(existing, updated)) return s;
      return mergeIdentityMessages(s, identityId, { ...byIdentity, [toId]: updated });
    }
    const rest = omitRecordKey(byIdentity, fromId);
    const target = byIdentity[toId];
    if (target?.status === 'acked') {
      // Keep Completes text/status, but carry forward local attachment metadata from the
      // optimistic row (voice memos cache Ogg before the LXMF hash is known).
      const merged: MessageRecord = {
        ...target,
        ...(existing.reticulumAttachmentPath && !target.reticulumAttachmentPath
          ? {
              reticulumAttachmentPath: existing.reticulumAttachmentPath,
              reticulumAttachmentKind:
                existing.reticulumAttachmentKind ?? target.reticulumAttachmentKind,
            }
          : {}),
        ...(existing.reticulumAudioMode != null && target.reticulumAudioMode == null
          ? { reticulumAudioMode: existing.reticulumAudioMode }
          : {}),
        ...(existing.reticulumAudioDurationSec != null && target.reticulumAudioDurationSec == null
          ? { reticulumAudioDurationSec: existing.reticulumAudioDurationSec }
          : {}),
      };
      if (messageRecordFieldsEqual(target, merged)) {
        return mergeIdentityMessages(s, identityId, rest);
      }
      return mergeIdentityMessages(s, identityId, { ...rest, [toId]: merged });
    }
    return mergeIdentityMessages(s, identityId, { ...rest, [toId]: { ...existing, id: toId } });
  });

  // Keep in-memory relay coverage keyed to the same bubble id ChatPanel looks up.
  // When dropping onto an already-acked Completes target, discard `fromId` coverage only —
  // do not merge/rename onto the delivered bubble (hash-collision retries).
  if (fromId === toId || fromExisting == null) return;
  if (dropOntoAckedCompletes) {
    useRelayCoverageStore.getState().remove(identityId, fromId);
    clearHeardRepeatWindowIfMessage(identityId, fromId);
    return;
  }
  useRelayCoverageStore.getState().renameMessage(identityId, fromId, toId);
  renameHeardRepeatWindowMessageId(identityId, fromId, toId);
}

export function updateMessageStatus(
  identityId: IdentityId,
  messageId: string,
  status: MessageStatus,
  error?: string,
): void {
  useMessageStore.setState((s) => {
    const byIdentity = s.messages[identityId];
    const existing = byIdentity?.[messageId];
    if (!existing) return s;
    // Completes must not regress to in-flight (retry / echo races).
    if (existing.status === 'acked' && status === 'sending') return s;
    const updated: MessageRecord = { ...existing, status };
    if (error !== undefined) {
      updated.error = error;
    } else if (status === 'acked') {
      updated.error = undefined;
    }
    if (messageRecordFieldsEqual(existing, updated)) return s;
    return mergeIdentityMessages(s, identityId, { ...byIdentity, [messageId]: updated });
  });
}

export function updateMessageMqttStatus(
  identityId: IdentityId,
  messageId: string,
  mqttStatus: MessageStatus,
): void {
  useMessageStore.setState((s) => {
    const byIdentity = s.messages[identityId];
    const existing = byIdentity?.[messageId];
    if (!existing) return s;
    const updated = { ...existing, mqttStatus };
    if (messageRecordFieldsEqual(existing, updated)) return s;
    return mergeIdentityMessages(s, identityId, { ...byIdentity, [messageId]: updated });
  });
}

export function deleteMessage(identityId: IdentityId, messageId: string): void {
  useMessageStore.setState((s) => {
    const byIdentity = s.messages[identityId];
    if (!byIdentity?.[messageId]) return s;
    return mergeIdentityMessages(s, identityId, omitRecordKey(byIdentity, messageId));
  });
}

export function clearMessageIdentity(identityId: IdentityId): void {
  useMessageStore.setState((s) => ({
    messages: omitRecordKey(s.messages, identityId),
  }));
}
