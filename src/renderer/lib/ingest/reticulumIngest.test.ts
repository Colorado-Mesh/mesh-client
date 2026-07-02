import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBlockStore } from '@/renderer/stores/blockStore';
import type { MessageRecord } from '@/renderer/stores/messageStore';

import { ingestReticulumLxmfPayload } from './reticulumIngest';

const upsertMessage = vi.fn();
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
