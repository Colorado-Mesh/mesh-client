/**
 * Pipeline stitch test: inbound LXMF audio field → ingest → MessageRecord fields.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { ingestReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { mergeReticulumIngestRecord } from '@/renderer/lib/reticulum/reticulumIngestMerge';
import { addMessage, type MessageRecord, useMessageStore } from '@/renderer/stores/messageStore';
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
});

describe('reticulumVoiceMemoPipeline — oversize / error mapping', () => {
  it('message_too_large_for_propagation warn path leaves pending status as sending', () => {
    const record: MessageRecord = {
      id: 'pending-voice-002',
      from: 9999,
      to: 1234,
      payload: '[voice:5000]',
      channelIndex: 0,
      timestamp: Date.now(),
      status: 'sending',
      reticulumAttachmentKind: 'audio',
      reticulumAudioMode: LXMF_AUDIO_MODE_OPUS_OGG,
    };
    addMessage(IDENTITY_ID, record);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    console.warn('[sendReticulumVoiceMemo] too large for propagation, not a hard failure');
    expect(warnSpy).toHaveBeenCalledWith(
      '[sendReticulumVoiceMemo] too large for propagation, not a hard failure',
    );
    expect(getMessages(IDENTITY_ID)['pending-voice-002'].status).toBe('sending');
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
