import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RRC_DEFAULT_HUBS } from '@/shared/rrcDefaultHubs';

import { useRrcHubStore } from './rrcHubStore';

describe('rrcHubStore', () => {
  beforeEach(() => {
    useRrcHubStore.getState().clear();
    vi.stubGlobal('electronAPI', {
      reticulum: {
        rrc: {
          listHubs: vi.fn().mockResolvedValue({
            hubs: [
              {
                destination_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                display_name: 'Live Hub',
                source: 'discovered',
                hops: 2,
              },
            ],
          }),
          setFavorite: vi.fn().mockResolvedValue({ ok: true }),
          upsertHub: vi.fn().mockResolvedValue({
            ok: true,
            hub: {
              destination_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              display_name: 'Manual',
              source: 'manual',
            },
          }),
        },
        getStatus: vi.fn().mockResolvedValue({ running: true, port: 1, pid: 1 }),
      },
    });
  });

  it('seeds recommended hubs', () => {
    const hubs = useRrcHubStore.getState().hubs;
    const [community, moscow] = RRC_DEFAULT_HUBS;
    expect(hubs.has(community.destinationHash)).toBe(true);
    expect(hubs.has(moscow.destinationHash)).toBe(true);
  });

  it('merges discovered hubs from refresh', async () => {
    await useRrcHubStore.getState().refreshFromSidecar();
    const hub = useRrcHubStore.getState().getHub('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(hub?.display_name).toBe('Live Hub');
    expect(hub?.hops).toBe(2);
    const [community] = RRC_DEFAULT_HUBS;
    expect(useRrcHubStore.getState().hubs.has(community.destinationHash)).toBe(true);
  });

  it('upserts manual hubs', async () => {
    const hub = await useRrcHubStore
      .getState()
      .upsertManual('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Manual');
    expect(hub?.destination_hash).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });
});
