// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { RNCP_RECEIVE_DEST_SHARE_PREFIX } from '@/shared/rncpRequestEnable';

import {
  applyRncpReceiveDestShareFromLxmf,
  rncpReceiveDestShareSavedToastMessage,
} from './applyRncpReceiveDestShare';

vi.mock('@/renderer/lib/i18n', () => ({
  default: {
    t: (key: string, opts?: { peer?: string }) => (opts?.peer ? `${key}:${opts.peer}` : key),
  },
}));

describe('applyRncpReceiveDestShareFromLxmf', () => {
  beforeEach(() => {
    useReticulumRemoteAddressStore.getState().clear();
    vi.mocked(window.electronAPI.db.upsertReticulumRemoteAddress).mockReset();
    vi.mocked(window.electronAPI.db.listReticulumRemoteAddresses).mockReset();
    vi.mocked(window.electronAPI.db.upsertReticulumRemoteAddress).mockResolvedValue({
      changes: 1,
    });
    vi.mocked(window.electronAPI.db.listReticulumRemoteAddresses).mockResolvedValue([
      {
        id: 'addr-1',
        label: 'Alice',
        service: 'rncp',
        destination_hash: 'cd'.repeat(16),
        lxmf_peer_hash: 'ab'.repeat(16),
        created_at: 1,
        updated_at: 1,
      },
    ]);
  });

  it('returns no_share for ordinary chat', async () => {
    await expect(
      applyRncpReceiveDestShareFromLxmf({
        senderHash: 'ab'.repeat(16),
        text: 'hello',
      }),
    ).resolves.toEqual({ ok: false, reason: 'no_share' });
    expect(window.electronAPI.db.upsertReticulumRemoteAddress).not.toHaveBeenCalled();
  });

  it('upserts lxmf→rncp mapping when share sentinel is present', async () => {
    const sender = 'ab'.repeat(16);
    const receive = 'cd'.repeat(16);
    const res = await applyRncpReceiveDestShareFromLxmf({
      senderHash: sender,
      senderName: 'Alice',
      text: `Here is my receive dest.\n\n${RNCP_RECEIVE_DEST_SHARE_PREFIX}${receive}`,
    });
    expect(res).toEqual({ ok: true, receiveHash: receive, lxmfPeerHash: sender });
    expect(window.electronAPI.db.upsertReticulumRemoteAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Alice',
        service: 'rncp',
        destination_hash: receive,
        lxmf_peer_hash: sender,
      }),
    );
  });

  it('returns invalid_sender when sender hash is not 32-hex', async () => {
    const receive = 'cd'.repeat(16);
    await expect(
      applyRncpReceiveDestShareFromLxmf({
        senderHash: 'short',
        text: `${RNCP_RECEIVE_DEST_SHARE_PREFIX}${receive}`,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_sender' });
    expect(window.electronAPI.db.upsertReticulumRemoteAddress).not.toHaveBeenCalled();
  });

  it('returns upsert_failed when remote-address persist fails', async () => {
    const sender = 'ab'.repeat(16);
    const receive = 'cd'.repeat(16);
    vi.mocked(window.electronAPI.db.upsertReticulumRemoteAddress).mockRejectedValueOnce(
      new Error('sqlite busy'),
    );
    await expect(
      applyRncpReceiveDestShareFromLxmf({
        senderHash: sender,
        senderName: 'Alice',
        text: `${RNCP_RECEIVE_DEST_SHARE_PREFIX}${receive}`,
      }),
    ).resolves.toEqual({ ok: false, reason: 'upsert_failed' });
  });

  it('rncpReceiveDestShareSavedToastMessage interpolates peer label', () => {
    expect(rncpReceiveDestShareSavedToastMessage('Alice')).toBe(
      'reticulumRemote.transfer.receiveDestSharedToast:Alice',
    );
  });
});
