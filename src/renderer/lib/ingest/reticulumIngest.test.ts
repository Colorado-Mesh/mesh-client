import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageStore } from '@/renderer/stores/messageStore';

import {
  ingestReticulumLxmfPayload,
  ingestReticulumLxmfPayloadWithSideEffects,
} from './reticulumIngest';

describe('reticulumIngest', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    vi.stubGlobal('window', {
      electronAPI: {
        db: {
          saveReticulumMessage: vi.fn().mockResolvedValue({ changes: 1 }),
          upsertReticulumDestination: vi.fn().mockResolvedValue({ changes: 1 }),
        },
      },
    });
  });

  it('stores LXMF hash and reply target on message record', () => {
    const ok = ingestReticulumLxmfPayload('offline-reticulum', {
      sender_hash: 'aa'.repeat(16),
      sender_name: 'Peer',
      text: 'hello',
      timestamp: 1_700_000_000_000,
      reply_to_hash: 'bb'.repeat(16),
      message_hash: 'cc'.repeat(16),
    });
    expect(ok).toBe(true);
    const bucket = useMessageStore.getState().messages['offline-reticulum'];
    expect(bucket).toBeDefined();
    const record = Object.values(bucket)[0];
    expect(record.reticulumMessageHash).toBe('cc'.repeat(16));
    expect(record.reticulumReplyToHash).toBe('bb'.repeat(16));
  });

  it('maps received_via on ingest and db persist', () => {
    const ok = ingestReticulumLxmfPayloadWithSideEffects('offline-reticulum', {
      sender_hash: 'aa'.repeat(16),
      sender_name: 'Peer',
      text: 'on rf',
      timestamp: 1_700_000_000_000,
      received_via: 'rf',
    });
    expect(ok).toBe(true);
    const record = Object.values(useMessageStore.getState().messages['offline-reticulum'])[0];
    expect(record.receivedVia).toBe('rf');
    expect(window.electronAPI.db.saveReticulumMessage).toHaveBeenCalledWith(
      expect.objectContaining({ received_via: 'rf' }),
    );
  });
});
