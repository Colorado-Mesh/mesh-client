import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  probeReticulumPeer: vi.fn(),
}));

import { probeReticulumPeer } from '@/renderer/lib/reticulum/reticulumSidecarReads';

import { ensureRncpDestinationReachable } from './ensureRncpDestinationReachable';

const DEST = 'a'.repeat(32);
const LXMF = 'b'.repeat(32);

describe('ensureRncpDestinationReachable', () => {
  beforeEach(() => {
    vi.mocked(probeReticulumPeer).mockReset();
  });

  it('returns reachable when the receive dest probe succeeds', async () => {
    vi.mocked(probeReticulumPeer).mockResolvedValueOnce({ ok: true, hops: 2 });
    await expect(
      ensureRncpDestinationReachable({ destinationHash: DEST, lxmfPeerHash: LXMF }),
    ).resolves.toEqual({ status: 'reachable', hops: 2 });
    expect(probeReticulumPeer).toHaveBeenCalledTimes(1);
    expect(probeReticulumPeer).toHaveBeenCalledWith(DEST);
  });

  it('returns listenerLikelyOff when dest fails but LXMF probe succeeds', async () => {
    vi.mocked(probeReticulumPeer)
      .mockResolvedValueOnce({ ok: false, error: 'timeout' })
      .mockResolvedValueOnce({ ok: true, hops: 1 });
    await expect(
      ensureRncpDestinationReachable({ destinationHash: DEST, lxmfPeerHash: LXMF }),
    ).resolves.toEqual({ status: 'listenerLikelyOff' });
    expect(probeReticulumPeer).toHaveBeenCalledWith(DEST);
    expect(probeReticulumPeer).toHaveBeenCalledWith(LXMF);
  });

  it('returns peerUnreachable when both probes fail', async () => {
    vi.mocked(probeReticulumPeer)
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false });
    await expect(
      ensureRncpDestinationReachable({ destinationHash: DEST, lxmfPeerHash: LXMF }),
    ).resolves.toEqual({ status: 'peerUnreachable' });
  });

  it('returns peerUnreachable when dest fails and no LXMF hash is provided', async () => {
    vi.mocked(probeReticulumPeer).mockResolvedValueOnce({ ok: false });
    await expect(ensureRncpDestinationReachable({ destinationHash: DEST })).resolves.toEqual({
      status: 'peerUnreachable',
    });
    expect(probeReticulumPeer).toHaveBeenCalledTimes(1);
  });

  it('returns peerUnreachable when LXMF hash equals the receive dest', async () => {
    vi.mocked(probeReticulumPeer).mockResolvedValueOnce({ ok: false });
    await expect(
      ensureRncpDestinationReachable({ destinationHash: DEST, lxmfPeerHash: DEST }),
    ).resolves.toEqual({ status: 'peerUnreachable' });
    expect(probeReticulumPeer).toHaveBeenCalledTimes(1);
  });

  it('returns peerUnreachable for invalid destination hashes without probing', async () => {
    await expect(
      ensureRncpDestinationReachable({ destinationHash: 'short', lxmfPeerHash: LXMF }),
    ).resolves.toEqual({ status: 'peerUnreachable' });
    expect(probeReticulumPeer).not.toHaveBeenCalled();
  });
});
