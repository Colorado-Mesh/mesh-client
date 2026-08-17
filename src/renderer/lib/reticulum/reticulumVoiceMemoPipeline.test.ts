/**
 * Pipeline stitch test: inbound LXMF audio field → ingest → MessageRecord fields.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

vi.mock('@/renderer/lib/i18n', () => ({
  default: { t: (key: string) => key },
}));

import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { ingestReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { applyReticulumOutboundDeliveryStatus } from '@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus';
import { extractLxmfPayloadFromSendResponse } from '@/renderer/lib/reticulum/lxmfSendResponse';
import { mergeReticulumIngestRecord } from '@/renderer/lib/reticulum/reticulumIngestMerge';
import {
  addMessage,
  type MessageRecord,
  renameMessageId,
  useMessageStore,
} from '@/renderer/stores/messageStore';
import { useReticulumVoiceMemoStore } from '@/renderer/stores/reticulumVoiceMemoStore';
import { LXMF_AUDIO_MODE_OPUS_OGG } from '@/shared/reticulum-voice-memo-types';

const IDENTITY_ID = 'test-identity-audio';
const SENDER_HASH = 'aaaa'.repeat(16).slice(0, 64);
const SELF_HASH = 'bbbb'.repeat(16).slice(0, 64);

function makeAudioPayload(overrides: Partial<ReticulumLxmfPayload> = {}): ReticulumLxmfPayload {
  return {
    sender_hash: SENDER_HASH,
    sender_name: 'Test Peer',
    text: '[voice:3000]',
    timestamp: 1_700_000_000_000,
    to_hash: SELF_HASH,
    direction: 'inbound',
    audio: { mode: LXMF_AUDIO_MODE_OPUS_OGG, data_base64: 'T2dnUw==', size_bytes: 4 },
    ...overrides,
  };
}

function getMessages(identityId: string): Record<string, MessageRecord> {
  return useMessageStore.getState().messages[identityId] ?? {};
}

beforeEach(() => {
  useMessageStore.setState({ messages: {} });
  useReticulumVoiceMemoStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reticulumVoiceMemoPipeline — inbound ingest with audio', () => {
  it('ingestReticulumLxmfPayload stamps reticulumAttachmentKind=audio and audioMode when ctx has them', () => {
    const p = makeAudioPayload();
    ingestReticulumLxmfPayload(IDENTITY_ID, p, {
      attachmentPath: '/cache/memo.ogg',
      attachmentKind: 'audio',
      audioMode: LXMF_AUDIO_MODE_OPUS_OGG,
    });

    const msgs = getMessages(IDENTITY_ID);
    const record = Object.values(msgs)[0];
    expect(record.reticulumAttachmentKind).toBe('audio');
    expect(record.reticulumAudioMode).toBe(LXMF_AUDIO_MODE_OPUS_OGG);
    expect(record.reticulumAttachmentPath).toBe('/cache/memo.ogg');
  });

  it('mergeReticulumIngestRecord preserves existing attachment on update', () => {
    const existing: MessageRecord = {
      id: 'msg-hash-001',
      from: 1,
      to: 2,
      payload: '[voice:3000]',
      channelIndex: 0,
      timestamp: 1_700_000_000_000,
      status: 'acked',
      reticulumAttachmentPath: '/cache/memo.ogg',
      reticulumAttachmentKind: 'audio',
      reticulumAudioMode: LXMF_AUDIO_MODE_OPUS_OGG,
    };
    const p = makeAudioPayload();
    const merged = mergeReticulumIngestRecord(
      existing,
      { ...existing, status: 'acked' as const },
      p,
      {},
    );
    expect(merged.reticulumAttachmentKind).toBe('audio');
    expect(merged.reticulumAudioMode).toBe(LXMF_AUDIO_MODE_OPUS_OGG);
    expect(merged.reticulumAttachmentPath).toBe('/cache/memo.ogg');
  });

  it('mergeReticulumIngestRecord applies incoming attachmentKind from ctx on new record', () => {
    const p = makeAudioPayload();
    const incoming: MessageRecord = {
      id: 'msg-hash-002',
      from: 1,
      to: 2,
      payload: '[voice:3000]',
      channelIndex: 0,
      timestamp: 1_700_000_000_000,
      status: 'acked',
    };
    const merged = mergeReticulumIngestRecord(undefined, incoming, p, {
      attachmentPath: '/cache/memo2.ogg',
      attachmentKind: 'audio',
      audioMode: LXMF_AUDIO_MODE_OPUS_OGG,
    });
    expect(merged.reticulumAttachmentKind).toBe('audio');
    expect(merged.reticulumAudioMode).toBe(LXMF_AUDIO_MODE_OPUS_OGG);
    expect(merged.reticulumAttachmentPath).toBe('/cache/memo2.ogg');
  });

  it('mergeReticulumIngestRecord preserves existing attachment when incoming omits attachment fields', () => {
    const existing: MessageRecord = {
      id: 'msg-hash-003',
      from: 1,
      to: 2,
      payload: '[voice:3000]',
      channelIndex: 0,
      timestamp: 1_700_000_000_000,
      status: 'acked',
      reticulumAttachmentPath: '/cache/memo.ogg',
      reticulumAttachmentKind: 'audio',
      reticulumAudioMode: LXMF_AUDIO_MODE_OPUS_OGG,
      reticulumAudioDurationSec: 3,
    };
    const p = makeAudioPayload();
    const incoming: MessageRecord = {
      id: 'msg-hash-003',
      from: 1,
      to: 2,
      payload: '[voice:3000]',
      channelIndex: 0,
      timestamp: 1_700_000_000_001,
      status: 'acked',
    };
    const merged = mergeReticulumIngestRecord(existing, incoming, p, {});
    expect(merged.reticulumAttachmentPath).toBe('/cache/memo.ogg');
    expect(merged.reticulumAttachmentKind).toBe('audio');
    expect(merged.reticulumAudioMode).toBe(LXMF_AUDIO_MODE_OPUS_OGG);
    expect(merged.reticulumAudioDurationSec).toBe(3);
  });
});

describe('reticulumVoiceMemoPipeline — optimistic send record', () => {
  it('optimistic record has correct reticulumAttachmentKind and audioMode', () => {
    const record: MessageRecord = {
      id: 'pending-voice-001',
      from: 9999,
      to: 1234,
      payload: '[voice:5000]',
      channelIndex: 0,
      timestamp: Date.now(),
      status: 'sending',
      reticulumAttachmentKind: 'audio',
      reticulumAudioMode: LXMF_AUDIO_MODE_OPUS_OGG,
      reticulumAudioDurationSec: 5,
    };
    addMessage(IDENTITY_ID, record);
    const stored = getMessages(IDENTITY_ID)['pending-voice-001'];
    expect(stored.reticulumAttachmentKind).toBe('audio');
    expect(stored.reticulumAudioMode).toBe(LXMF_AUDIO_MODE_OPUS_OGG);
    expect(stored.reticulumAudioDurationSec).toBe(5);
  });

  it('nested lxmf/send response rekeys pending → hash (no duplicate bubble)', () => {
    const pendingId = 'reticulum-pending-voice-1';
    const hash = 'cd'.repeat(32);
    addMessage(IDENTITY_ID, {
      id: pendingId,
      from: 9999,
      to: 1234,
      payload: '[voice:3000]',
      channelIndex: 0,
      timestamp: 1_700_000_000_000,
      status: 'sending',
      reticulumAttachmentPath: '/cache/out.ogg',
      reticulumAttachmentKind: 'audio',
      reticulumAudioMode: LXMF_AUDIO_MODE_OPUS_OGG,
    });

    // Live sidecar nests the wire payload (same shape text send already unwraps).
    const nestedRes = {
      ok: true,
      message: {
        ok: true,
        sent_via: 'tcp',
        message: {
          sender_hash: SELF_HASH,
          text: '[voice:3000]',
          message_hash: hash,
          direction: 'outbound',
          delivery_status: 'sending',
          to_hash: SENDER_HASH,
        },
      },
    };
    const lxmfPayload = extractLxmfPayloadFromSendResponse(nestedRes);
    expect(lxmfPayload?.message_hash).toBe(hash);
    // Bug without unwrap: res.message.message_hash is undefined → pending never renamed.
    expect((nestedRes.message as { message_hash?: string }).message_hash).toBeUndefined();

    renameMessageId(IDENTITY_ID, pendingId, hash);
    const bucket = getMessages(IDENTITY_ID);
    expect(bucket[pendingId]).toBeUndefined();
    expect(bucket[hash].reticulumAttachmentPath).toBe('/cache/out.ogg');
    expect(bucket[hash].status).toBe('sending');
  });
});

describe('reticulumVoiceMemoPipeline — oversize / error mapping', () => {
  it('applyReticulumOutboundDeliveryStatus stamps message_too_large_for_propagation on failed rows', () => {
    const hash = 'ab'.repeat(32);
    addMessage(IDENTITY_ID, {
      id: hash,
      from: 9999,
      to: 1234,
      payload: '[voice:5000]',
      channelIndex: 0,
      timestamp: Date.now(),
      status: 'sending',
      reticulumAttachmentKind: 'audio',
      reticulumAudioMode: LXMF_AUDIO_MODE_OPUS_OGG,
    });
    applyReticulumOutboundDeliveryStatus(IDENTITY_ID, hash, 'failed', {
      error: 'message_too_large_for_propagation',
    });
    const row = getMessages(IDENTITY_ID)[hash];
    expect(row.status).toBe('failed');
    expect(row.error).toBe('message_too_large_for_propagation');
  });
});

describe('reticulumVoiceMemoStore — state transitions', () => {
  it('starts idle and can transition through recording to idle', () => {
    const s = useReticulumVoiceMemoStore.getState();
    expect(s.phase).toBe('idle');
    s.setStarting();
    expect(useReticulumVoiceMemoStore.getState().phase).toBe('starting');
    useReticulumVoiceMemoStore.getState().startRecording('sess-1');
    expect(useReticulumVoiceMemoStore.getState().phase).toBe('recording');
    useReticulumVoiceMemoStore.getState().reset();
    expect(useReticulumVoiceMemoStore.getState().phase).toBe('idle');
  });
});
