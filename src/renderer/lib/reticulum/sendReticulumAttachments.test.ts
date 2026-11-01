// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/components/Toast', () => ({ pushAppToast: vi.fn() }));
vi.mock('@/renderer/lib/i18n', () => ({ default: { t: (key: string) => key } }));

const ingestMock = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/lib/ingest/reticulumIngest', () => ({
  ingestReticulumLxmfPayloadWithSideEffects: ingestMock,
  persistReticulumOutboundRecord: vi.fn(),
  resolveReticulumOutboundSenderHash: () => 'aa'.repeat(16),
}));
vi.mock('@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus', () => ({
  flushPendingReticulumOutboundDeliveryStatus: vi.fn(),
}));
vi.mock('@/renderer/lib/reticulum/destHash', () => ({
  reticulumHashToNodeId: () => 0x1234,
}));
vi.mock('@/renderer/lib/reticulum/sendReticulumChatMessage', () => ({
  resolveReticulumChatDestHashDetailed: vi.fn(() => ({ status: 'ok', hash: 'bb'.repeat(16) })),
}));
vi.mock('@/renderer/lib/sessions/reticulumSession', () => ({
  tryGetReticulumSession: vi.fn(() => ({
    selfNodeId: 0x99,
    getFullNodeLabel: () => 'Me',
  })),
  resolveReticulumOutboundVia: () => 'local',
}));

import { resolveReticulumChatDestHashDetailed } from '@/renderer/lib/reticulum/sendReticulumChatMessage';
import { useMessageStore } from '@/renderer/stores/messageStore';
import { useReticulumAttachmentSendStore } from '@/renderer/stores/reticulumAttachmentSendStore';

import {
  cancelReticulumAttachmentTransfer,
  RETICULUM_ATTACHMENT_PROGRESS_POLL_MS,
  sendReticulumAttachments,
} from './sendReticulumAttachments';

const IDENTITY = 'id-attach';
const HASH = 'cd'.repeat(32);

const proxyPost = vi.fn();
const proxyGet = vi.fn();
const saveReticulumAttachment = vi.fn();

function wirePayload(): Record<string, unknown> {
  return {
    sender_hash: 'aa'.repeat(16),
    text: '[file:a.txt:text/plain]',
    timestamp: 1,
    to_hash: 'bb'.repeat(16),
    message_hash: HASH,
    direction: 'outbound',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useMessageStore.setState({ messages: {} });
  useReticulumAttachmentSendStore.getState().reset();
  proxyPost.mockReset();
  proxyGet.mockReset().mockResolvedValue({ ok: true, progress: 0.4 });
  saveReticulumAttachment.mockReset().mockResolvedValue({ success: true, path: '/cache/a.txt' });
  ingestMock.mockReset();
  window.electronAPI = {
    reticulum: {
      proxyPost: (...a: unknown[]) => proxyPost(...a),
      proxyGet: (...a: unknown[]) => proxyGet(...a),
    },
    chat: {
      saveReticulumAttachment: (...a: unknown[]) => saveReticulumAttachment(...a),
    },
  } as unknown as typeof window.electronAPI;
});

afterEach(() => {
  vi.useRealTimers();
});

const files = {
  kind: 'files' as const,
  files: [{ fileName: 'a.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('hello') }],
};

describe('sendReticulumAttachments', () => {
  it('posts native attachments (not rncp) and tracks progress', async () => {
    proxyPost.mockResolvedValueOnce({ ok: true, message: wirePayload() });
    const onFailure = vi.fn();
    const ok = await sendReticulumAttachments({
      identityId: IDENTITY,
      destination: 0x1234,
      prepared: files,
      onFailure,
    });
    expect(ok).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
    expect(proxyPost).toHaveBeenCalledWith('/api/v1/lxmf/send', {
      destination_hash: 'bb'.repeat(16),
      text: '',
      attachments: [{ file_name: 'a.txt', data_base64: btoa('hello') }],
    });
    expect(saveReticulumAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'a.txt', promptSave: false }),
    );
    expect(ingestMock).toHaveBeenCalledWith(
      IDENTITY,
      expect.objectContaining({ message_hash: HASH }),
      expect.objectContaining({ attachmentPath: '/cache/a.txt', attachmentKind: 'image' }),
    );
    const row = useMessageStore.getState().messages[IDENTITY][HASH];
    expect(row.payload).toBe('[file:a.txt:text/plain]');
    expect(row.reticulumAttachmentPath).toBe('/cache/a.txt');

    await vi.advanceTimersByTimeAsync(RETICULUM_ATTACHMENT_PROGRESS_POLL_MS + 10);
    expect(proxyGet).toHaveBeenCalledWith(`/api/v1/lxmf/messages/${HASH}/progress`);
    expect(useReticulumAttachmentSendStore.getState().transfers[0]?.progress).toBe(0.4);

    // Terminal status ends the transfer chip.
    useMessageStore.setState((s) => ({
      messages: {
        ...s.messages,
        [IDENTITY]: {
          ...s.messages[IDENTITY],
          [HASH]: { ...s.messages[IDENTITY][HASH], status: 'acked' },
        },
      },
    }));
    await vi.advanceTimersByTimeAsync(RETICULUM_ATTACHMENT_PROGRESS_POLL_MS + 10);
    expect(useReticulumAttachmentSendStore.getState().transfers).toHaveLength(0);
  });

  it('sends a photo as native FIELD_IMAGE', async () => {
    proxyPost.mockResolvedValueOnce({ ok: true, message: wirePayload() });
    await sendReticulumAttachments({
      identityId: IDENTITY,
      destination: 0x1234,
      prepared: {
        kind: 'photo',
        photo: {
          fileName: 'p.jpg',
          format: 'jpeg',
          mimeType: 'image/jpeg',
          bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
        },
      },
      onFailure: vi.fn(),
    });
    const body = proxyPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.image).toEqual({ format: 'jpeg', data_base64: btoa('\xff\xd8\xff') });
    expect(body.attachments).toBeUndefined();
  });

  it.each([
    ['attachment_too_large: 999 > 245760', 'attachment_too_large'],
    ['attachment_count_exceeded: 5 > 4', 'attachment_count_exceeded'],
    ['image_magic_mismatch: png', 'image_magic_mismatch'],
    ['no_propagation_node', 'no_propagation_node'],
    ['message_too_large_for_propagation', 'too_large_for_propagation'],
    ['something else', 'send_failed'],
  ])('maps sidecar error %s to %s and fails the row', async (err, reason) => {
    proxyPost.mockResolvedValueOnce({ ok: false, error: err });
    const onFailure = vi.fn();
    const ok = await sendReticulumAttachments({
      identityId: IDENTITY,
      destination: 0x1234,
      prepared: files,
      onFailure,
    });
    expect(ok).toBe(false);
    expect(onFailure).toHaveBeenCalledWith(reason);
    const rows = Object.values(useMessageStore.getState().messages[IDENTITY]);
    expect(rows[0]?.status).toBe('failed');
    expect(useReticulumAttachmentSendStore.getState().transfers).toHaveLength(0);
  });

  it('rejects a Voice-only destination before any wire call', async () => {
    vi.mocked(resolveReticulumChatDestHashDetailed).mockReturnValueOnce({
      status: 'missing_lxmf',
    } as never);
    const onFailure = vi.fn();
    expect(
      await sendReticulumAttachments({
        identityId: IDENTITY,
        destination: 1,
        prepared: files,
        onFailure,
      }),
    ).toBe(false);
    expect(onFailure).toHaveBeenCalledWith('missing_lxmf_delivery');
    expect(proxyPost).not.toHaveBeenCalled();
  });

  it('does not send when the local cache write fails', async () => {
    saveReticulumAttachment.mockResolvedValueOnce({ success: false });
    const onFailure = vi.fn();
    expect(
      await sendReticulumAttachments({
        identityId: IDENTITY,
        destination: 1,
        prepared: files,
        onFailure,
      }),
    ).toBe(false);
    expect(onFailure).toHaveBeenCalledWith('cache_failed');
    expect(proxyPost).not.toHaveBeenCalled();
  });

  it('cancel posts to the sidecar and marks the row cancelled', async () => {
    proxyPost.mockResolvedValueOnce({ ok: true, message: wirePayload() });
    await sendReticulumAttachments({
      identityId: IDENTITY,
      destination: 0x1234,
      prepared: files,
      onFailure: vi.fn(),
    });
    const id = useReticulumAttachmentSendStore.getState().transfers[0].id;
    proxyPost.mockResolvedValueOnce({ ok: true, cancelled: true, message_hash: HASH });
    await cancelReticulumAttachmentTransfer(id);
    expect(proxyPost).toHaveBeenLastCalledWith(`/api/v1/lxmf/messages/${HASH}/cancel`, {});
    const row = useMessageStore.getState().messages[IDENTITY][HASH];
    expect(row.status).toBe('failed');
    expect(useReticulumAttachmentSendStore.getState().transfers).toHaveLength(0);
  });

  it('cancel during enqueue is honoured once the hash is known', async () => {
    let resolveSend: (v: unknown) => void = () => undefined;
    proxyPost.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveSend = r;
        }),
    );
    const sending = sendReticulumAttachments({
      identityId: IDENTITY,
      destination: 0x1234,
      prepared: files,
      onFailure: vi.fn(),
    });
    await vi.waitFor(() => {
      expect(useReticulumAttachmentSendStore.getState().transfers).toHaveLength(1);
    });
    const id = useReticulumAttachmentSendStore.getState().transfers[0].id;
    await cancelReticulumAttachmentTransfer(id); // no hash yet → flagged only
    expect(useReticulumAttachmentSendStore.getState().transfers[0].cancelling).toBe(true);
    proxyPost.mockResolvedValueOnce({ ok: true, cancelled: true });
    resolveSend({ ok: true, message: wirePayload() });
    await sending;
    await vi.waitFor(() => {
      expect(proxyPost).toHaveBeenLastCalledWith(`/api/v1/lxmf/messages/${HASH}/cancel`, {});
    });
  });
});
