import { create } from 'zustand';

import type { IdentityId } from '../lib/types';

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

/**
 * Re-key a message (used when the optimistic provisional id is replaced by the
 * SDK-assigned packetId on send completion).
 */
export function renameMessageId(identityId: IdentityId, fromId: string, toId: string): void {
  useMessageStore.setState((s) => {
    const byIdentity = s.messages[identityId];
    const existing = byIdentity?.[fromId];
    if (!existing) return s;
    const { [fromId]: _removed, ...rest } = byIdentity;
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
    return {
      messages: {
        ...s.messages,
        [identityId]: { ...byIdentity, [messageId]: { ...existing, status, error } },
      },
    };
  });
}

export function clearMessageIdentity(identityId: IdentityId): void {
  useMessageStore.setState((s) => {
    const { [identityId]: _removed, ...rest } = s.messages;
    return { messages: rest };
  });
}
