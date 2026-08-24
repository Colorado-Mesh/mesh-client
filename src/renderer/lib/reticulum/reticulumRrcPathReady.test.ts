import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as pathMedium from '@/renderer/lib/reticulum/reticulumPathMedium';
import {
  evaluateReticulumRrcPathReady,
  probeReticulumRrcPathReady,
  resetReticulumRrcPathReadyForTests,
} from '@/renderer/lib/reticulum/reticulumRrcPathReady';
import * as transportReady from '@/renderer/lib/reticulum/reticulumRrcTransportReady';
import * as sidecarReads from '@/renderer/lib/reticulum/reticulumSidecarReads';
import * as peerStore from '@/renderer/stores/reticulumPeerStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';

const HUB = 'd765e919676aa0340412a1afae006553';

const ratspeakSlot = {
  active: true,
  hops: 2,
  via_hash: null,
  interface: 'Ratspeak',
  interface_id: 1,
  medium: 'network' as const,
  timestamp: 1,
  expires: 999,
  expired: false,
};

describe('evaluateReticulumRrcPathReady', () => {
  it('does not treat passive hops alone as RRC-ready', () => {
    expect(evaluateReticulumRrcPathReady(2, 'Ratspeak')).toEqual({
      ready: false,
      reason: 'no_path',
      passiveHops: 2,
      passiveIface: 'Ratspeak',
    });
  });

  it('is not ready without hops', () => {
    expect(evaluateReticulumRrcPathReady(null)).toEqual({
      ready: false,
      reason: 'no_path',
      hops: null,
      passiveHops: null,
    });
  });
});

describe('probeReticulumRrcPathReady', () => {
  beforeEach(() => {
    resetReticulumRrcPathReadyForTests();
    useReticulumPeerStore.setState({ peers: new Map(), contacts: new Map(), history: new Map() });
    vi.spyOn(sidecarReads, 'requestReticulumPeerPath').mockResolvedValue({ ok: true });
    vi.spyOn(sidecarReads, 'probeReticulumPeer').mockResolvedValue({ ok: true, hops: 2 });
    vi.spyOn(peerStore, 'refreshReticulumPeersFromSidecar').mockResolvedValue([]);
    vi.spyOn(transportReady, 'probeReticulumRrcTransportReady').mockResolvedValue({ ready: true });
    vi.spyOn(pathMedium, 'setReticulumPeerMediumPin').mockResolvedValue({ ok: true });
    vi.spyOn(pathMedium, 'refreshReticulumPeerRouteFromPaths').mockResolvedValue({
      ok: true,
      paths: [ratspeakSlot],
    });
    vi.spyOn(pathMedium, 'fetchReticulumPeerPaths').mockResolvedValue({
      ok: true,
      paths: [ratspeakSlot],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires live probe even when passive hops exist', async () => {
    useReticulumPeerStore.getState().updatePeer(HUB, { hops: 2, interface: 'Ratspeak' });
    const res = await probeReticulumRrcPathReady(HUB);
    expect(res).toMatchObject({ ready: true, hops: 2, source: 'probe' });
    expect(sidecarReads.probeReticulumPeer).toHaveBeenCalledWith(HUB);
    expect(pathMedium.setReticulumPeerMediumPin).not.toHaveBeenCalled();
  });

  it('defers connect when probe ok but hops are unknown and no viable path slot', async () => {
    vi.spyOn(sidecarReads, 'probeReticulumPeer').mockResolvedValue({ ok: true });
    vi.spyOn(pathMedium, 'fetchReticulumPeerPaths').mockResolvedValue({ ok: true, paths: [] });
    const res = await probeReticulumRrcPathReady(HUB);
    expect(res).toMatchObject({ ready: false, reason: 'no_path' });
  });

  it('uses a good passive route when probe ok but omits hops', async () => {
    useReticulumPeerStore.getState().updatePeer(HUB, { hops: 2, interface: 'Ratspeak' });
    vi.spyOn(sidecarReads, 'probeReticulumPeer').mockResolvedValue({ ok: true });
    vi.spyOn(pathMedium, 'fetchReticulumPeerPaths').mockResolvedValue({ ok: true, paths: [] });
    const res = await probeReticulumRrcPathReady(HUB);
    expect(res).toMatchObject({ ready: true, hops: 2, iface: 'Ratspeak' });
  });

  it('does not connect on stale passive hops when probe omits hops but slots show a good route', async () => {
    useReticulumPeerStore.getState().updatePeer(HUB, { hops: 42, interface: 'RNS DFW Central' });
    vi.spyOn(sidecarReads, 'probeReticulumPeer').mockResolvedValue({ ok: true });
    vi.spyOn(pathMedium, 'fetchReticulumPeerPaths').mockResolvedValue({
      ok: true,
      paths: [
        {
          active: true,
          hops: 42,
          via_hash: null,
          interface: 'RNS DFW Central',
          interface_id: 1,
          medium: 'network',
          timestamp: 1,
          expires: 999,
          expired: false,
        },
        ratspeakSlot,
      ],
    });
    const res = await probeReticulumRrcPathReady(HUB);
    expect(res).toMatchObject({ ready: true, hops: 2, iface: 'Ratspeak' });
  });

  it('defers connect when all path slots exceed RRC hop limit', async () => {
    useReticulumPeerStore.getState().updatePeer(HUB, { hops: 12, interface: 'RMAP World' });
    vi.spyOn(sidecarReads, 'probeReticulumPeer').mockResolvedValue({ ok: true });
    vi.spyOn(pathMedium, 'fetchReticulumPeerPaths').mockResolvedValue({
      ok: true,
      paths: [
        {
          active: true,
          hops: 12,
          via_hash: null,
          interface: 'RMAP World',
          interface_id: 1,
          medium: 'network',
          timestamp: 1,
          expires: 999,
          expired: false,
        },
      ],
    });
    const res = await probeReticulumRrcPathReady(HUB);
    expect(res).toMatchObject({ ready: false, reason: 'no_path' });
  });

  it('forces stale path recovery when passive hops exceed the RRC cap', async () => {
    useReticulumPeerStore.getState().updatePeer(HUB, { hops: 43, interface: 'RNS DFW Central' });
    vi.spyOn(pathMedium, 'fetchReticulumPeerPaths').mockResolvedValue({
      ok: true,
      paths: [
        {
          active: true,
          hops: 43,
          via_hash: null,
          interface: 'RNS DFW Central',
          interface_id: 1,
          medium: 'network',
          timestamp: 1,
          expires: 999,
          expired: false,
        },
      ],
    });
    await probeReticulumRrcPathReady(HUB);
    expect(pathMedium.setReticulumPeerMediumPin).toHaveBeenCalledWith(HUB, null);
    expect(sidecarReads.requestReticulumPeerPath).toHaveBeenCalledWith(HUB, { force: true });
  });

  it('returns probe_failed when live probe fails despite passive hops', async () => {
    useReticulumPeerStore.getState().updatePeer(HUB, { hops: 42, interface: 'RNS DFW Central' });
    vi.spyOn(sidecarReads, 'probeReticulumPeer').mockResolvedValue({
      ok: false,
      error: 'timeout',
    });
    const res = await probeReticulumRrcPathReady(HUB);
    expect(res).toMatchObject({
      ready: false,
      reason: 'probe_failed',
      passiveHops: 42,
      passiveIface: 'RNS DFW Central',
    });
  });

  it('caches successful probe for the session', async () => {
    const res1 = await probeReticulumRrcPathReady(HUB);
    expect(res1.ready).toBe(true);
    vi.mocked(sidecarReads.probeReticulumPeer).mockClear();
    const res2 = await probeReticulumRrcPathReady(HUB);
    expect(res2.ready).toBe(true);
    expect(sidecarReads.probeReticulumPeer).not.toHaveBeenCalled();
  });
});
