import { create } from 'zustand';

import type { IdentityId } from '../lib/types';
import { omitRecordKey } from './storeUtils';

export type MessageStatus = 'sending' | 'acked' | 'failed';

export type MessageTransport = 'rf' | 'mqtt' | 'both';

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
}

interface MessageStoreState {
  messages: Record<IdentityId, Record<string, MessageRecord>>;
}

const defaultState: MessageStoreState = {
  messages: {},
};

export const useMessageStore = create<MessageStoreState>()(() => defaultState);

export function addMessage(identityId: IdentityId, message: MessageRecord): void {
  useMessageStore.setState((s) => ({
    messages: {
      ...s.messages,
      [identityId]: { ...(s.messages[identityId] ?? {}), [message.id]: message },
    },
  }));
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
    return {
      messages: { ...s.messages, [identityId]: { ...byIdentity, [message.id]: merged } },
    };
  });
}

/** Single setState merge for many messages (startup / DB hydration). */
export function upsertMessageRecordsForIdentity(
  identityId: IdentityId,
  records: MessageRecord[],
): void {
  if (records.length === 0) return;
  useMessageStore.setState((s) => {
    const byIdentity = { ...(s.messages[identityId] ?? {}) };
    for (const message of records) {
      const existing = byIdentity[message.id];
      byIdentity[message.id] = existing ? { ...existing, ...message } : message;
    }
    return {
      messages: { ...s.messages, [identityId]: byIdentity },
    };
  });
}

/**
 * Re-key a message (used when the optimistic provisional id is replaced by the
 * SDK-assigned packetId on send completion).
 */
export function renameMessageId(identityId: IdentityId, fromId: string, toId: string): void {
  useMessageStore.setState((s) => {
    const byIdentity = s.messages[identityId];
    const existing = byIdentity?.[fromId];
    if (!existing) return s;
    const rest = omitRecordKey(byIdentity, fromId);
    return {
      messages: {
        ...s.messages,
        [identityId]: { ...rest, [toId]: { ...existing, id: toId } },
      },
    };
  });
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
    const updated: MessageRecord = { ...existing, status };
    if (error !== undefined) {
      updated.error = error;
    } else if (status === 'acked') {
      updated.error = undefined;
    }
    return {
      messages: {
        ...s.messages,
        [identityId]: { ...byIdentity, [messageId]: updated },
      },
    };
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
    return {
      messages: {
        ...s.messages,
        [identityId]: { ...byIdentity, [messageId]: { ...existing, mqttStatus } },
      },
    };
  });
}

export function deleteMessage(identityId: IdentityId, messageId: string): void {
  useMessageStore.setState((s) => {
    const byIdentity = s.messages[identityId];
    if (!byIdentity?.[messageId]) return s;
    return {
      messages: {
        ...s.messages,
        [identityId]: omitRecordKey(byIdentity, messageId),
      },
    };
  });
}

export function clearMessageIdentity(identityId: IdentityId): void {
  useMessageStore.setState((s) => ({
    messages: omitRecordKey(s.messages, identityId),
  }));
}
