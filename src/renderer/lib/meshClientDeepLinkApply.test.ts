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

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({}));

vi.mock('@/renderer/stores/reticulumPeerStore', () => ({
  refreshReticulumPeersFromSidecar: vi.fn().mockResolvedValue(undefined),
}));

const ingestReticulumLxmfPayloadWithSideEffects = vi.fn().mockReturnValue(true);

vi.mock('@/renderer/lib/ingest/reticulumIngest', () => ({
  ingestReticulumLxmfPayloadWithSideEffects: (...args: unknown[]) =>
    ingestReticulumLxmfPayloadWithSideEffects(...args),
}));

vi.mock('@/renderer/lib/identityByProtocol', () => ({
  getIdentityIdForProtocol: () => 'id-reticulum',
}));

vi.mock('@/renderer/lib/offlineProtocolIdentities', () => ({
  getOfflineIdentityIdForProtocol: () => 'id-reticulum-offline',
}));

import { applyMeshcoreChannelAdd, applyMeshcoreContactAdd } from './meshClientDeepLinkApply';

describe('meshClientDeepLinkApply', () => {
  beforeEach(() => {
    upsertReticulumDestination.mockReset();
    upsertReticulumDestination.mockResolvedValue({ changes: 1 });
    proxyPost.mockReset();
    ingestReticulumLxmfPayloadWithSideEffects.mockClear();
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
});
