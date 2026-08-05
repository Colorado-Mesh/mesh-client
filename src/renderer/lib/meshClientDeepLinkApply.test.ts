import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertReticulumDestination = vi.fn().mockResolvedValue({ changes: 1 });
const proxyPost = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    db: {
      upsertReticulumDestination,
    },
    reticulum: {
      proxyPost,
    },
  },
});

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  registerReticulumKnownIdentity: vi.fn(),
}));

vi.mock('@/renderer/stores/reticulumPeerStore', () => ({
  refreshReticulumPeersFromSidecar: vi.fn().mockResolvedValue(undefined),
}));

import { registerReticulumKnownIdentity } from '@/renderer/lib/reticulum/reticulumSidecarReads';

import {
  applyLxmaContactImport,
  applyLxmContactImport,
  applyLxmPaperIngest,
  applyMeshcoreChannelAdd,
  applyMeshcoreContactAdd,
} from './meshClientDeepLinkApply';

describe('meshClientDeepLinkApply', () => {
  beforeEach(() => {
    vi.mocked(registerReticulumKnownIdentity).mockReset();
    upsertReticulumDestination.mockReset();
    upsertReticulumDestination.mockResolvedValue({ changes: 1 });
    proxyPost.mockReset();
  });

  it('applyLxmaContactImport registers then upserts with is_contact', async () => {
    vi.mocked(registerReticulumKnownIdentity).mockResolvedValue({ ok: true });
    const dest = 'a'.repeat(32);
    const pub = 'b'.repeat(128);
    const result = await applyLxmaContactImport({
      destinationHash: dest,
      publicKeyHex: pub,
      displayName: 'Zed',
    });
    expect(result).toEqual({ ok: true, kind: 'lxmaContact' });
    expect(registerReticulumKnownIdentity).toHaveBeenCalledWith(dest, pub);
    expect(upsertReticulumDestination).toHaveBeenCalledWith(
      expect.objectContaining({
        destination_hash: dest,
        display_name: 'Zed',
        is_contact: true,
      }),
    );
  });

  it('applyLxmaContactImport skips upsert when register fails', async () => {
    vi.mocked(registerReticulumKnownIdentity).mockResolvedValue({
      ok: false,
      error: 'sidecar_not_running',
    });
    const result = await applyLxmaContactImport({
      destinationHash: 'a'.repeat(32),
      publicKeyHex: 'b'.repeat(128),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe('qrIngest.lxmaRegisterFailed');
    expect(upsertReticulumDestination).not.toHaveBeenCalled();
  });

  it('applyLxmContactImport upserts without is_contact by default', async () => {
    const result = await applyLxmContactImport({
      destinationHash: 'c'.repeat(32),
      name: 'Ann',
    });
    expect(result.ok).toBe(true);
    expect(upsertReticulumDestination).toHaveBeenCalledWith(
      expect.objectContaining({
        destination_hash: 'c'.repeat(32),
        display_name: 'Ann',
      }),
    );
    const arg = upsertReticulumDestination.mock.calls[0]?.[0] as {
      is_contact?: boolean;
    };
    expect(arg.is_contact).toBeUndefined();
  });

  it('applyMeshcoreContactAdd calls saveContact dep', async () => {
    const saveContact = vi.fn().mockResolvedValue(true);
    const result = await applyMeshcoreContactAdd(
      { name: 'N', publicKeyHex: 'ab'.repeat(32), type: 2 },
      { saveContact },
    );
    expect(result).toEqual({ ok: true, kind: 'meshcoreContactAdd' });
    expect(saveContact).toHaveBeenCalledWith(
      expect.objectContaining({
        publicKeyHex: 'ab'.repeat(32),
        name: 'N',
        contactType: 2,
        nodeId: expect.any(Number),
      }),
    );
  });

  it('applyMeshcoreContactAdd rejects short or non-hex publicKeyHex', async () => {
    const saveContact = vi.fn().mockResolvedValue(true);
    const result = await applyMeshcoreContactAdd(
      { name: 'N', publicKeyHex: 'zz', type: 1 },
      { saveContact },
    );
    expect(result).toEqual({ ok: false, errorKey: 'qrIngest.meshcoreContactImportFailed' });
    expect(saveContact).not.toHaveBeenCalled();
  });

  it('applyMeshcoreChannelAdd calls applyChannel dep', async () => {
    const applyChannel = vi.fn().mockResolvedValue('accepted');
    const result = await applyMeshcoreChannelAdd(
      { name: 'Pub', secretHex: 'cd'.repeat(16) },
      { applyChannel },
    );
    expect(result).toEqual({ ok: true, kind: 'meshcoreChannelAdd' });
    expect(applyChannel).toHaveBeenCalledWith({ name: 'Pub', secretHex: 'cd'.repeat(16) });
  });

  it('applyLxmPaperIngest posts uri to sidecar', async () => {
    proxyPost.mockResolvedValue({ ok: true });
    const uri = `lxm://${'A'.repeat(48)}`;
    const result = await applyLxmPaperIngest({ uri });
    expect(result).toEqual({ ok: true, kind: 'lxmPaperMessage' });
    expect(proxyPost).toHaveBeenCalledWith('/api/v1/lxmf/paper/ingest', { uri });
  });

  it('applyLxmPaperIngest maps decrypt_failed', async () => {
    proxyPost.mockResolvedValue({ ok: false, error: 'decrypt_failed' });
    const result = await applyLxmPaperIngest({ uri: `lxm://${'B'.repeat(48)}` });
    expect(result).toEqual({
      ok: false,
      errorKey: 'qrIngest.paperDecryptFailed',
      detail: 'decrypt_failed',
    });
  });

  it('applyLxmPaperIngest maps invalid_uri', async () => {
    proxyPost.mockResolvedValue({ ok: false, error: 'invalid_uri' });
    const result = await applyLxmPaperIngest({ uri: 'lxm://bad' });
    expect(result).toEqual({
      ok: false,
      errorKey: 'qrIngest.paperInvalidUri',
      detail: 'invalid_uri',
    });
  });
});
