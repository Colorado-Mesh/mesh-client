import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBlockStore } from '@/renderer/stores/blockStore';
import type { MessageRecord } from '@/renderer/stores/messageStore';

import {
  ingestReticulumLxmfPayload,
  isReticulumHashPrefixAlias,
  persistReticulumContactFromPayload,
  reticulumContactDisplayNameFromPayload,
} from './reticulumIngest';

const upsertMessage = vi.fn();
const upsertReticulumDestination = vi.fn();
let messagesState: Record<string, Record<string, MessageRecord>> = {};

vi.mock('@/renderer/stores/messageStore', () => ({
  upsertMessage: (...args: unknown[]) => upsertMessage(...args),
  useMessageStore: {
    getState: () => ({ messages: messagesState }),
  },
}));

vi.mock('@/renderer/stores/reticulumPeerStore', () => ({
  useReticulumPeerStore: {
    getState: () => ({ restoreDismissedContact: vi.fn() }),
  },
}));

beforeEach(() => {
  upsertReticulumDestination.mockReset();
  upsertReticulumDestination.mockResolvedValue(undefined);
  vi.stubGlobal('window', {
    electronAPI: {
      db: { upsertReticulumDestination },
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

  it('persistReticulumContactFromPayload skips display_name for hash prefix', async () => {
    await persistReticulumContactFromPayload({
      sender_hash: hash,
      sender_name: 'deadbeefdead',
      timestamp: 1_700_000_000_000,
    });
    expect(upsertReticulumDestination).toHaveBeenCalledWith({
      destination_hash: hash,
      last_heard: 1_700_000_000,
    });
  });

  it('persistReticulumContactFromPayload keeps real display names', async () => {
    await persistReticulumContactFromPayload({
      sender_hash: hash,
      sender_name: 'Alice',
      timestamp: 1_700_000_000_000,
    });
    expect(upsertReticulumDestination).toHaveBeenCalledWith({
      destination_hash: hash,
      display_name: 'Alice',
      last_heard: 1_700_000_000,
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
