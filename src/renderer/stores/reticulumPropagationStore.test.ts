import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStatus = vi.fn();
const proxyGet = vi.fn();
const proxyPost = vi.fn();
const proxyPut = vi.fn();
const proxyDelete = vi.fn();

import { DEFAULT_PN_HOSTING_POLICY } from '@/shared/pnHostingPolicy';
import { RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC } from '@/shared/reticulumPropagationAutoSync';

vi.stubGlobal('window', {
  electronAPI: {
    reticulum: {
      getStatus,
      proxyGet,
      proxyPost,
      proxyPut,
      proxyDelete,
    },
  },
});

import { useReticulumPropagationStore } from './reticulumPropagationStore';

describe('reticulumPropagationStore', () => {
  beforeEach(() => {
    getStatus.mockReset();
    proxyGet.mockReset();
    proxyPost.mockReset();
    proxyPut.mockReset();
    proxyDelete.mockReset();
    useReticulumPropagationStore.setState({
      nodes: [],
      discovered: [],
      preferredId: null,
      autoSyncIntervalSec: RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC,
      hostingPolicy: { ...DEFAULT_PN_HOSTING_POLICY },
      sync: { active: false, progress: 0, message: null },
      lastSyncError: null,
      lastAddError: null,
      lastHostingPolicyError: null,
      lastRefreshedAt: null,
      lastPropagationSyncAt: null,
      lastPropagationSyncAttemptAt: null,
      activePropagationSyncAttemptAt: null,
    });
  });

  it('refreshFromSidecar sets nodes and preferred id', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet
      .mockResolvedValueOnce({
        propagation: [{ id: 'p1', name: 'Node', enabled: true, status: 'ok' }],
        preferred_id: 'p1',
        auto_sync_interval_sec: 120,
      })
      .mockResolvedValueOnce({
        discovered: [
          {
            destination_hash: 'deadbeefbadfceeae39c1aceb911e205',
            display_name: 'Ratspeak',
            hops: 2,
            node_state: true,
            peering_cost: 18,
          },
        ],
      });

    await useReticulumPropagationStore.getState().refreshFromSidecar();

    expect(useReticulumPropagationStore.getState().nodes).toHaveLength(1);
    expect(useReticulumPropagationStore.getState().preferredId).toBe('p1');
    expect(useReticulumPropagationStore.getState().autoSyncIntervalSec).toBe(120);
    expect(useReticulumPropagationStore.getState().lastRefreshedAt).toBeTypeOf('number');
    expect(useReticulumPropagationStore.getState().discovered).toHaveLength(1);
  });

  it('addFromDiscovered promotes and optionally prefers', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useReticulumPropagationStore.setState({
      discovered: [
        {
          destination_hash: 'aabbccddeeff00112233445566778899',
          display_name: 'Heard PN',
          hops: 1,
          node_state: true,
          peering_cost: 0,
        },
      ],
    });
    proxyPost.mockResolvedValue({ ok: true });
    proxyGet.mockResolvedValue({
      propagation: [
        {
          id: 'pn-aabbccdd',
          name: 'Heard PN',
          enabled: true,
          status: 'known',
          destination_hash: 'aabbccddeeff00112233445566778899',
        },
      ],
      preferred_id: 'pn-aabbccdd',
    });

    await expect(
      useReticulumPropagationStore
        .getState()
        .addFromDiscovered('aabbccddeeff00112233445566778899', { prefer: true }),
    ).resolves.toBe(true);

    expect(proxyPost).toHaveBeenCalledWith('/api/v1/propagation/add', {
      destination_hash: 'aabbccddeeff00112233445566778899',
      name: 'Heard PN',
    });
    expect(proxyPost).toHaveBeenCalledWith('/api/v1/propagation/pn-aabbccdd/preferred', {});
  });

  it('addFromDiscovered with prefer returns false when Preferred POST fails', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useReticulumPropagationStore.setState({
      discovered: [
        {
          destination_hash: 'aabbccddeeff00112233445566778899',
          display_name: 'Heard PN',
          hops: 1,
          node_state: true,
          peering_cost: 0,
        },
      ],
    });
    proxyPost
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'not_ready' });
    proxyGet.mockResolvedValue({
      propagation: [
        {
          id: 'pn-aabbccdd',
          name: 'Heard PN',
          enabled: true,
          status: 'known',
          destination_hash: 'aabbccddeeff00112233445566778899',
        },
      ],
      preferred_id: null,
    });

    await expect(
      useReticulumPropagationStore
        .getState()
        .addFromDiscovered('aabbccddeeff00112233445566778899', { prefer: true }),
    ).resolves.toBe(false);
  });

  it('refreshFromSidecar skips when sidecar is down', async () => {
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await useReticulumPropagationStore.getState().refreshFromSidecar();
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it('setAutoSyncIntervalOnSidecar persists interval', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockResolvedValueOnce({ ok: true });

    await expect(
      useReticulumPropagationStore.getState().setAutoSyncIntervalOnSidecar(1800),
    ).resolves.toBe(true);

    expect(proxyPost).toHaveBeenCalledWith('/api/v1/propagation/auto-sync-interval', {
      interval_sec: 1800,
    });
    expect(useReticulumPropagationStore.getState().autoSyncIntervalSec).toBe(1800);
  });

  it('startSync and cancelSync update sync state', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useReticulumPropagationStore.setState({ preferredId: 'p1' });
    proxyPost.mockResolvedValueOnce({ ok: true });
    await expect(useReticulumPropagationStore.getState().startSync()).resolves.toBe(true);
    expect(useReticulumPropagationStore.getState().sync.active).toBe(true);
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAttemptAt).toBeTypeOf(
      'number',
    );

    proxyPost.mockResolvedValueOnce({ ok: true });
    await expect(useReticulumPropagationStore.getState().cancelSync()).resolves.toBe(true);
    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncCancelled',
    );
  });

  it('cancelSync keeps a prior sidecar establish failure over timeout reason', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockResolvedValueOnce({ ok: true });
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 10, message: null },
      lastSyncError: 'reticulumPropagation.syncEstablishNoLinkProof',
    });
    await expect(
      useReticulumPropagationStore
        .getState()
        .cancelSync({ reasonKey: 'reticulumPropagation.syncTimedOut' }),
    ).resolves.toBe(true);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncEstablishNoLinkProof',
    );
  });

  it('cancelSync preserves sidecar cancel error payload', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockResolvedValueOnce({ ok: false, error: 'PROPAGATION_IDENTITY_UNKNOWN' });
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 40, message: null },
      lastSyncError: null,
      activePropagationSyncAttemptAt: 9_001,
    });
    await expect(useReticulumPropagationStore.getState().cancelSync()).resolves.toBe(false);
    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncIdentityUnknown',
    );
    expect(useReticulumPropagationStore.getState().activePropagationSyncAttemptAt).toBeNull();
  });

  it('cancelSync clears active sync when proxyPost fails', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockRejectedValueOnce(new Error('proxy down'));
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 25, message: null },
      lastSyncError: null,
    });
    await expect(useReticulumPropagationStore.getState().cancelSync()).resolves.toBe(false);
    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncCancelled',
    );
  });

  it('refreshFromSidecar clears phantom activePropagationSyncAttemptAt', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useReticulumPropagationStore.setState({
      activePropagationSyncAttemptAt: 12_345,
      lastPropagationSyncAttemptAt: 12_345,
    });
    proxyGet
      .mockResolvedValueOnce({
        propagation: [],
        preferred_id: null,
        last_propagation_sync_at: 1_700_000_000,
      })
      .mockResolvedValueOnce({ discovered: [] });

    await useReticulumPropagationStore.getState().refreshFromSidecar();

    expect(useReticulumPropagationStore.getState().activePropagationSyncAttemptAt).toBeNull();
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAt).toBe(
      1_700_000_000 * 1000,
    );
  });

  it('refreshFromSidecar clamps future last_propagation_sync_at to now', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    const before = Date.now();
    const futureSec = Math.floor(before / 1000) + 60 * 60 * 24 * 365;
    proxyGet
      .mockResolvedValueOnce({
        propagation: [],
        preferred_id: null,
        last_propagation_sync_at: futureSec,
      })
      .mockResolvedValueOnce({ discovered: [] });

    await useReticulumPropagationStore.getState().refreshFromSidecar();

    const at = useReticulumPropagationStore.getState().lastPropagationSyncAt;
    expect(at).toBeTypeOf('number');
    expect(at!).toBeLessThanOrEqual(Date.now());
    expect(at!).toBeGreaterThanOrEqual(before);
  });

  it('startSync settles local-prop in-process without a stall watchdog error', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockResolvedValueOnce({ ok: true });
    await expect(useReticulumPropagationStore.getState().startSync('local-prop')).resolves.toBe(
      true,
    );
    expect(proxyPost).toHaveBeenCalledWith('/api/v1/propagation/sync', {
      propagation_id: 'local-prop',
    });
    expect(useReticulumPropagationStore.getState().lastSyncError).toBeNull();
    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAt).toBeTypeOf('number');
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAttemptAt).toBeNull();
    expect(useReticulumPropagationStore.getState().activePropagationSyncAttemptAt).toBeNull();
  });

  it('older success completion does not clear a newer failed attempt stamp', () => {
    const olderAttempt = 1_000;
    const newerAttempt = 2_000;
    useReticulumPropagationStore.setState({
      lastPropagationSyncAttemptAt: newerAttempt,
      activePropagationSyncAttemptAt: null,
      lastPropagationSyncAt: null,
    });

    useReticulumPropagationStore.getState().setLastPropagationSyncAt(3_000, olderAttempt);

    expect(useReticulumPropagationStore.getState().lastPropagationSyncAt).toBe(3_000);
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAttemptAt).toBe(newerAttempt);
  });

  it('matching success completion clears its own attempt stamp', () => {
    const attemptAt = 5_000;
    useReticulumPropagationStore.setState({
      lastPropagationSyncAttemptAt: attemptAt,
      activePropagationSyncAttemptAt: attemptAt,
      lastPropagationSyncAt: null,
    });

    useReticulumPropagationStore.getState().setLastPropagationSyncAt(6_000, attemptAt);

    expect(useReticulumPropagationStore.getState().lastPropagationSyncAt).toBe(6_000);
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAttemptAt).toBeNull();
    expect(useReticulumPropagationStore.getState().activePropagationSyncAttemptAt).toBeNull();
  });

  it('startSync maps sidecar identity errors to i18n keys', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useReticulumPropagationStore.setState({ preferredId: 'pn-vegas' });
    proxyPost.mockResolvedValueOnce({ ok: false, error: 'PROPAGATION_IDENTITY_UNKNOWN' });
    await expect(useReticulumPropagationStore.getState().startSync()).resolves.toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncIdentityUnknown',
    );
  });

  it('startSync maps non-PN destination errors to i18n keys', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useReticulumPropagationStore.setState({ preferredId: 'pn-vegas' });
    proxyPost.mockResolvedValueOnce({ ok: false, error: 'PROPAGATION_TARGET_NOT_PN' });
    await expect(useReticulumPropagationStore.getState().startSync()).resolves.toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncTargetNotPropagationNode',
    );
  });

  it('removePropagationNode deletes then refreshes', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyDelete.mockResolvedValueOnce({ ok: true });
    proxyGet.mockResolvedValueOnce({
      propagation: [{ id: 'local-prop', name: 'Local', enabled: true, status: 'ok' }],
      preferred_id: null,
    });

    await expect(
      useReticulumPropagationStore.getState().removePropagationNode('pn-aabb'),
    ).resolves.toBe(true);

    expect(proxyDelete).toHaveBeenCalledWith('/api/v1/propagation/pn-aabb');
    expect(useReticulumPropagationStore.getState().nodes).toHaveLength(1);
  });

  it('removePropagationNode returns false when proxy rejects', async () => {
    proxyDelete.mockResolvedValueOnce({ ok: false });
    await expect(
      useReticulumPropagationStore.getState().removePropagationNode('pn-aabb'),
    ).resolves.toBe(false);
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it('renamePropagationNode renames then refreshes', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPut.mockResolvedValueOnce({ ok: true });
    proxyGet.mockResolvedValueOnce({
      propagation: [{ id: 'pn-aabb', name: 'Renamed hub', enabled: true, status: 'known' }],
      preferred_id: null,
    });

    await expect(
      useReticulumPropagationStore.getState().renamePropagationNode('pn-aabb', 'Renamed hub'),
    ).resolves.toBe(true);

    expect(proxyPut).toHaveBeenCalledWith('/api/v1/propagation/pn-aabb', {
      name: 'Renamed hub',
    });
    expect(useReticulumPropagationStore.getState().nodes[0]?.name).toBe('Renamed hub');
  });

  it('renamePropagationNode returns false when proxy rejects', async () => {
    proxyPut.mockResolvedValueOnce({ ok: false });
    await expect(
      useReticulumPropagationStore.getState().renamePropagationNode('pn-aabb', 'Nope'),
    ).resolves.toBe(false);
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it('setHostingPolicyOnSidecar posts valid policy and updates state', async () => {
    const policy = {
      ...DEFAULT_PN_HOSTING_POLICY,
      peering_cost: 12,
      max_peering_cost: 26,
    };
    proxyPost.mockResolvedValueOnce({ ok: true });

    await expect(
      useReticulumPropagationStore.getState().setHostingPolicyOnSidecar(policy),
    ).resolves.toBe(true);

    expect(proxyPost).toHaveBeenCalledWith('/api/v1/propagation/hosting-policy', policy);
    expect(useReticulumPropagationStore.getState().hostingPolicy.peering_cost).toBe(12);
    expect(useReticulumPropagationStore.getState().lastHostingPolicyError).toBeNull();
    expect(useReticulumPropagationStore.getState().lastAddError).toBeNull();
  });

  it('setHostingPolicyOnSidecar rejects peering_cost > max without proxyPost', async () => {
    const policy = {
      ...DEFAULT_PN_HOSTING_POLICY,
      peering_cost: 30,
      max_peering_cost: 26,
    };

    await expect(
      useReticulumPropagationStore.getState().setHostingPolicyOnSidecar(policy),
    ).resolves.toBe(false);

    expect(proxyPost).not.toHaveBeenCalled();
    expect(useReticulumPropagationStore.getState().lastHostingPolicyError).toBe(
      'networkPanel.reticulumPnHosting.error.peeringCostExceedsMax',
    );
    expect(useReticulumPropagationStore.getState().lastAddError).toBeNull();
  });

  it('setHostingPolicyOnSidecar maps API ok:false to lastHostingPolicyError', async () => {
    proxyPost.mockResolvedValueOnce({ ok: false, error: 'static_peers_too_many' });

    await expect(
      useReticulumPropagationStore
        .getState()
        .setHostingPolicyOnSidecar({ ...DEFAULT_PN_HOSTING_POLICY }),
    ).resolves.toBe(false);

    expect(useReticulumPropagationStore.getState().lastHostingPolicyError).toBe(
      'networkPanel.reticulumPnHosting.error.staticPeersTooMany',
    );
    expect(useReticulumPropagationStore.getState().lastAddError).toBeNull();
  });

  it('refreshFromSidecar applies pn_hosting_policy from body', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet
      .mockResolvedValueOnce({
        propagation: [],
        preferred_id: null,
        pn_hosting_policy: {
          ...DEFAULT_PN_HOSTING_POLICY,
          peering_cost: 14,
        },
      })
      .mockResolvedValueOnce({ discovered: [] });

    await useReticulumPropagationStore.getState().refreshFromSidecar();

    expect(useReticulumPropagationStore.getState().hostingPolicy.peering_cost).toBe(14);
  });

  it('refreshFromSidecar preserves activePropagationSyncAttemptAt mid-sync', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    const attemptAt = 99_001;
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 25, message: null },
      activePropagationSyncAttemptAt: attemptAt,
      lastPropagationSyncAttemptAt: attemptAt,
    });
    proxyGet
      .mockResolvedValueOnce({
        propagation: [],
        preferred_id: null,
      })
      .mockResolvedValueOnce({ discovered: [] });

    await useReticulumPropagationStore.getState().refreshFromSidecar();

    expect(useReticulumPropagationStore.getState().activePropagationSyncAttemptAt).toBe(attemptAt);
  });
});
