import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBlockStore } from '@/renderer/stores/blockStore';
import type { MessageRecord } from '@/renderer/stores/messageStore';

import {
  ingestReticulumLxmfPayload,
  ingestReticulumLxmfPayloadWithSideEffects,
  isReticulumHashPrefixAlias,
  persistReticulumContactFromPayload,
  persistReticulumHistoryFromPayload,
  reticulumContactDisplayNameFromPayload,
} from './reticulumIngest';

const upsertMessage = vi.fn();
const upsertReticulumDestination = vi.fn();
const saveReticulumMessage = vi.fn();
let messagesState: Record<string, Record<string, MessageRecord>> = {};

vi.mock('@/renderer/stores/messageStore', () => ({
  upsertMessage: (...args: unknown[]) => upsertMessage(...args),
  useMessageStore: {
    getState: () => ({ messages: messagesState }),
  },
}));

const restoreDismissedContact = vi.fn();
const getPeer = vi.fn();
const stampHistoryPeer = vi.fn();
const upsertNodeRecordsForIdentity = vi.fn();

vi.mock('@/renderer/stores/reticulumPeerStore', () => ({
  reticulumContactToNodeRecordPreservingLabel: (contact: { destination_hash: string }) => ({
    nodeId: 1,
    reticulumDestinationHash: contact.destination_hash,
  }),
  useReticulumPeerStore: {
    getState: () => ({ restoreDismissedContact, getPeer, stampHistoryPeer }),
  },
}));

vi.mock('@/renderer/stores/nodeStore', () => ({
  upsertNodeRecordsForIdentity: (...args: unknown[]) => upsertNodeRecordsForIdentity(...args),
  useNodeStore: {
    // Proxy so any identityId resolves to an empty node map (lazy buckets in prod).
    getState: () => ({
      nodes: new Proxy(
        {},
        {
          get: () => ({}),
        },
      ),
    }),
  },
}));

beforeEach(() => {
  upsertReticulumDestination.mockReset();
  upsertReticulumDestination.mockResolvedValue(undefined);
  saveReticulumMessage.mockReset();
  saveReticulumMessage.mockResolvedValue(undefined);
  restoreDismissedContact.mockReset();
  stampHistoryPeer.mockReset();
  upsertNodeRecordsForIdentity.mockReset();
  getPeer.mockReset();
  getPeer.mockReturnValue(undefined);
  vi.stubGlobal('window', {
    electronAPI: {
      db: { upsertReticulumDestination, saveReticulumMessage },
    },
  });
});

describe('reticulumIngest alias helpers', () => {
  const hash = 'deadbeef'.repeat(4);

  it('detects hash-prefix placeholders', () => {
    expect(isReticulumHashPrefixAlias(hash, 'deadbeefdead')).toBe(true);
    expect(isReticulumHashPrefixAlias(hash, 'Alice')).toBe(false);
  });

  it('omits hash-prefix names from contact upsert payload', () => {
    expect(
      reticulumContactDisplayNameFromPayload({
        sender_hash: hash,
        sender_name: 'deadbeefdead',
      }),
    ).toBeUndefined();
    expect(
      reticulumContactDisplayNameFromPayload({
        sender_hash: hash,
        sender_name: 'Alice',
      }),
    ).toBe('Alice');
  });

  it('extracts server_name from JSON sender_name and rejects RMAP blobs', () => {
    expect(
      reticulumContactDisplayNameFromPayload({
        sender_hash: hash,
        sender_name: '{"server_name": "FOXDPI RetiBBS"}',
      }),
    ).toBe('FOXDPI RetiBBS');
    expect(
      reticulumContactDisplayNameFromPayload({
        sender_hash: hash,
        sender_name: '{"h":"5440f5d4485a00fb8441ad94fbdee46e","ha":"0"}',
      }),
    ).toBeUndefined();
  });

  it('persistReticulumContactFromPayload skips display_name for hash prefix (explicit save helper)', async () => {
    await persistReticulumContactFromPayload({
      sender_hash: hash,
      sender_name: 'deadbeefdead',
      timestamp: 1_700_000_000_000,
    });
    expect(upsertReticulumDestination).toHaveBeenCalledWith({
      destination_hash: hash,
      last_heard: 1_700_000_000,
      is_contact: true,
    });
  });

  it('persistReticulumContactFromPayload keeps real display names (explicit save helper)', async () => {
    await persistReticulumContactFromPayload({
      sender_hash: hash,
      sender_name: 'Alice',
      timestamp: 1_700_000_000_000,
    });
    expect(upsertReticulumDestination).toHaveBeenCalledWith({
      destination_hash: hash,
      display_name: 'Alice',
      last_heard: 1_700_000_000,
      is_contact: true,
    });
  });

  it('persistReticulumContactFromPayload uses to_hash for outbound helper payloads', async () => {
    const peerHash = 'cafebabe'.repeat(4);
    getPeer.mockReturnValue({ display_name: 'Bob' });
    await persistReticulumContactFromPayload({
      sender_hash: hash,
      sender_name: 'Me',
      to_hash: peerHash,
      direction: 'outbound',
      timestamp: 1_700_000_000_000,
    });
    expect(restoreDismissedContact).toHaveBeenCalledWith(peerHash);
    expect(upsertReticulumDestination).toHaveBeenCalledWith({
      destination_hash: peerHash,
      display_name: 'Bob',
      last_heard: 1_700_000_000,
      is_contact: true,
    });
  });

  it('persistReticulumHistoryFromPayload stamps last_heard without is_contact', async () => {
    getPeer.mockReturnValue({
      destination_hash: hash,
      last_heard: 1_700_000_000,
      display_name: 'Alice',
    });
    await persistReticulumHistoryFromPayload({
      sender_hash: hash,
      sender_name: 'Alice',
      timestamp: 1_700_000_000_000,
    });
    expect(restoreDismissedContact).not.toHaveBeenCalled();
    expect(upsertReticulumDestination).toHaveBeenCalledWith({
      destination_hash: hash,
      display_name: 'Alice',
      last_heard: 1_700_000_000,
    });
    expect(stampHistoryPeer).toHaveBeenCalledWith(hash, {
      last_heard: 1_700_000_000,
      display_name: 'Alice',
    });
    expect(upsertNodeRecordsForIdentity).toHaveBeenCalled();
  });
});

describe('reticulumIngest side effects — history stamp, no auto-contact', () => {
  beforeEach(() => {
    upsertMessage.mockClear();
    messagesState = {};
    getPeer.mockImplementation((hash: string) => ({
      destination_hash: hash,
      last_heard: 1_700_000_000,
      display_name: 'Peer',
    }));
    useBlockStore.setState({
      protocol: 'reticulum',
      identityId: 'id-1',
      blockedHashes: new Set(),
      loaded: true,
    });
  });

  it('inbound LXMF stamps history last_heard without is_contact', async () => {
    const hash = 'allowedhash1234567890allowedhash12';
    const ingested = ingestReticulumLxmfPayloadWithSideEffects('id-1', {
      sender_hash: hash,
      sender_name: 'Alice',
      text: 'hello',
      direction: 'inbound',
      timestamp: 1_700_000_000_000,
    });
    expect(ingested).toBe(true);
    expect(upsertMessage).toHaveBeenCalled();
    expect(saveReticulumMessage).toHaveBeenCalled();
    expect(restoreDismissedContact).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(upsertReticulumDestination).toHaveBeenCalledWith({
        destination_hash: hash,
        display_name: 'Alice',
        last_heard: 1_700_000_000,
      });
    });
    expect(upsertReticulumDestination.mock.calls[0]?.[0]).not.toHaveProperty('is_contact');
    expect(stampHistoryPeer).toHaveBeenCalled();
  });

  it('outbound LXMF stamps recipient history without is_contact', async () => {
    const selfHash = 'deadbeef'.repeat(4);
    const peerHash = 'cafebabe'.repeat(4);
    getPeer.mockReturnValue({
      destination_hash: peerHash,
      display_name: 'Bob',
      last_heard: 1_700_000_000,
    });
    const ingested = ingestReticulumLxmfPayloadWithSideEffects('id-1', {
      sender_hash: selfHash,
      sender_name: 'Me',
      to_hash: peerHash,
      text: 'hello',
      direction: 'outbound',
      timestamp: 1_700_000_000_000,
    });
    expect(ingested).toBe(true);
    expect(upsertMessage).toHaveBeenCalled();
    expect(saveReticulumMessage).toHaveBeenCalled();
    expect(restoreDismissedContact).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(upsertReticulumDestination).toHaveBeenCalledWith({
        destination_hash: peerHash,
        display_name: 'Bob',
        last_heard: 1_700_000_000,
      });
    });
    expect(upsertReticulumDestination.mock.calls[0]?.[0]).not.toHaveProperty('is_contact');
    expect(stampHistoryPeer).toHaveBeenCalledWith(peerHash, {
      last_heard: 1_700_000_000,
      display_name: 'Bob',
    });
  });
});

describe('reticulumIngest blocked senders', () => {
  beforeEach(() => {
    upsertMessage.mockClear();
    messagesState = {};
    useBlockStore.setState({
      protocol: 'reticulum',
      identityId: 'id-1',
      blockedHashes: new Set(['deadbeef1234567890deadbeef12345678']),
      loaded: true,
    });
  });

  it('skips ingest for blocked sender_hash', () => {
    const ingested = ingestReticulumLxmfPayload('id-1', {
      sender_hash: 'deadbeef1234567890deadbeef12345678',
      text: 'hello',
      direction: 'inbound',
    });
    expect(ingested).toBe(false);
  });

  it('ingests non-blocked sender', () => {
    const ingested = ingestReticulumLxmfPayload('id-1', {
      sender_hash: 'allowedhash1234567890allowedhash12',
      text: 'hello',
      direction: 'inbound',
    });
    expect(ingested).toBe(true);
  });
});

describe('reticulumIngest reactions', () => {
  beforeEach(() => {
    upsertMessage.mockClear();
    messagesState = {};
    useBlockStore.setState({
      protocol: 'reticulum',
      identityId: 'offline-reticulum',
      blockedHashes: new Set(),
      loaded: true,
    });
  });

  it('stores reaction_target as tapback parent hash', () => {
    const parentHash = 'bb'.repeat(16);
    const ok = ingestReticulumLxmfPayload('offline-reticulum', {
      sender_hash: 'aa'.repeat(16),
      sender_name: 'Peer',
      text: '👍',
      timestamp: 1_700_000_000_000,
      reaction_target: parentHash,
      message_hash: 'cc'.repeat(16),
    });
    expect(ok).toBe(true);
    expect(upsertMessage).toHaveBeenCalled();
    const record = upsertMessage.mock.calls.at(-1)?.[1] as {
      tapback?: boolean;
      reticulumReplyToHash?: string;
    };
    expect(record.tapback).toBe(true);
    expect(record.reticulumReplyToHash).toBe(parentHash);
  });
});

describe('reticulumIngest reply quotes', () => {
  const identityId = 'offline-reticulum';
  const parentHash = 'ab'.repeat(32);
  const childHash = 'cd'.repeat(32);
  const senderHash = '11'.repeat(16);

  beforeEach(() => {
    upsertMessage.mockClear();
    messagesState = {
      [identityId]: {
        [parentHash]: {
          id: parentHash,
          from: 1,
          senderName: 'Alice',
          to: 2,
          payload: 'Original parent body that is long enough to truncate in previews',
          channelIndex: 0,
          timestamp: 1_700_000_000_000,
          status: 'acked',
          reticulumMessageHash: parentHash,
        },
      },
    };
    useBlockStore.setState({
      protocol: 'reticulum',
      identityId,
      blockedHashes: new Set(),
      loaded: true,
    });
  });

  it('enriches replyPreview fields from parent hash in store', () => {
    const ok = ingestReticulumLxmfPayload(identityId, {
      sender_hash: senderHash,
      sender_name: 'Bob',
      text: 'reply body',
      timestamp: 1_700_000_001_000,
      reply_to_hash: parentHash,
      message_hash: childHash,
      direction: 'inbound',
    });
    expect(ok).toBe(true);
    const record = upsertMessage.mock.calls.at(-1)?.[1] as MessageRecord;
    expect(record.reticulumReplyToHash).toBe(parentHash);
    expect(record.replyPreviewSender).toBe('Alice');
    expect(record.replyPreviewText).toBe('Original parent body that is long enough to trunca…');
  });

  it('uses wire reply_preview_text when parent is absent', () => {
    messagesState = {};
    const ok = ingestReticulumLxmfPayload(identityId, {
      sender_hash: senderHash,
      sender_name: 'Bob',
      text: 'reply body',
      timestamp: 1_700_000_001_000,
      reply_to_hash: parentHash,
      reply_preview_text: 'Quoted offline',
      reply_preview_sender: 'Carol',
      message_hash: childHash,
      direction: 'inbound',
    });
    expect(ok).toBe(true);
    const record = upsertMessage.mock.calls.at(-1)?.[1] as MessageRecord;
    expect(record.reticulumReplyToHash).toBe(parentHash);
    expect(record.replyPreviewText).toBe('Quoted offline');
    expect(record.replyPreviewSender).toBe('Carol');
  });
});
