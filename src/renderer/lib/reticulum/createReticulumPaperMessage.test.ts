import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyPost = vi.fn();
const ingestReticulumLxmfPayloadWithSideEffects = vi.fn().mockReturnValue(true);

vi.stubGlobal('window', {
  electronAPI: {
    reticulum: {
      proxyPost,
    },
  },
});

vi.mock('@/renderer/lib/ingest/reticulumIngest', () => ({
  ingestReticulumLxmfPayloadWithSideEffects: (...args: unknown[]) =>
    ingestReticulumLxmfPayloadWithSideEffects(...args),
}));

import { createReticulumPaperMessage } from './createReticulumPaperMessage';

describe('createReticulumPaperMessage', () => {
  beforeEach(() => {
    proxyPost.mockReset();
    ingestReticulumLxmfPayloadWithSideEffects.mockClear();
  });

  it('rejects empty text without calling sidecar', async () => {
    const result = await createReticulumPaperMessage({
      identityId: 'id-1',
      destinationHash: 'aa'.repeat(16),
      text: '   ',
    });
    expect(result).toEqual({ ok: false, errorKey: 'chatPanel.shareAsPaperEmpty' });
    expect(proxyPost).not.toHaveBeenCalled();
  });

  it('rejects invalid destination hash', async () => {
    const result = await createReticulumPaperMessage({
      identityId: 'id-1',
      destinationHash: 'not-a-hash',
      text: 'hi',
    });
    expect(result).toEqual({ ok: false, errorKey: 'chatPanel.shareAsPaperFailed' });
    expect(proxyPost).not.toHaveBeenCalled();
  });

  it('maps identity_unknown from sidecar', async () => {
    proxyPost.mockResolvedValue({ ok: false, error: 'identity_unknown' });
    const result = await createReticulumPaperMessage({
      identityId: 'id-1',
      destinationHash: 'bb'.repeat(16),
      text: 'hello',
    });
    expect(result).toEqual({
      ok: false,
      errorKey: 'chatPanel.shareAsPaperIdentityUnknown',
    });
  });

  it('maps paper_too_large from sidecar', async () => {
    proxyPost.mockResolvedValue({ ok: false, error: 'paper_too_large' });
    const result = await createReticulumPaperMessage({
      identityId: 'id-1',
      destinationHash: 'bb'.repeat(16),
      text: 'x'.repeat(5000),
    });
    expect(result).toEqual({
      ok: false,
      errorKey: 'chatPanel.shareAsPaperTooLarge',
    });
  });

  it('ingests outbound payload and returns uri on success', async () => {
    const dest = 'cc'.repeat(16);
    const messageHash = 'dd'.repeat(16);
    const payload = {
      sender_hash: 'aa'.repeat(16),
      sender_name: 'Me',
      text: 'paper hello',
      timestamp: 1_700_000_000_000,
      to_hash: dest,
      direction: 'outbound',
      delivery_method: 'paper',
      sent_via: 'paper',
      received_via: 'paper',
      delivery_status: 'delivered',
      message_hash: messageHash,
    };
    proxyPost.mockResolvedValue({
      ok: true,
      uri: `lxm://${'E'.repeat(48)}`,
      message_hash: messageHash,
      message: payload,
    });

    const result = await createReticulumPaperMessage({
      identityId: 'id-1',
      destinationHash: dest,
      text: 'paper hello',
    });

    expect(result).toEqual({
      ok: true,
      uri: `lxm://${'E'.repeat(48)}`,
      messageHash,
    });
    expect(proxyPost).toHaveBeenCalledWith('/api/v1/lxmf/paper/create', {
      destination_hash: dest,
      text: 'paper hello',
    });
    expect(ingestReticulumLxmfPayloadWithSideEffects).toHaveBeenCalledWith('id-1', payload, {
      selfLxmfHash: 'aa'.repeat(16),
    });
  });

  it('fails when sidecar omits message_hash', async () => {
    proxyPost.mockResolvedValue({
      ok: true,
      uri: `lxm://${'F'.repeat(48)}`,
      message: {
        sender_hash: 'aa'.repeat(16),
        text: 'hi',
      },
    });
    const result = await createReticulumPaperMessage({
      identityId: 'id-1',
      destinationHash: 'bb'.repeat(16),
      text: 'hi',
    });
    expect(result).toEqual({ ok: false, errorKey: 'chatPanel.shareAsPaperFailed' });
    expect(ingestReticulumLxmfPayloadWithSideEffects).not.toHaveBeenCalled();
  });

  it('maps proxyPost transport rejection to shareAsPaperFailed', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      proxyPost.mockRejectedValue(new Error('network down'));
      const result = await createReticulumPaperMessage({
        identityId: 'id-1',
        destinationHash: 'bb'.repeat(16),
        text: 'hi',
      });
      expect(result).toEqual({ ok: false, errorKey: 'chatPanel.shareAsPaperFailed' });
      expect(ingestReticulumLxmfPayloadWithSideEffects).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});
