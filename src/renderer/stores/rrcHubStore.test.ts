import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('starts with an empty hub map (no curated seed)', () => {
    expect(useRrcHubStore.getState().hubs.size).toBe(0);
  });

  it('merges discovered hubs from refresh', async () => {
    await useRrcHubStore.getState().refreshFromSidecar();
    const hub = useRrcHubStore.getState().getHub('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(hub?.display_name).toBe('Live Hub');
    expect(hub?.hops).toBe(2);
    expect(useRrcHubStore.getState().hubs.size).toBe(1);
  });

  it('upserts manual hubs', async () => {
    const hub = await useRrcHubStore
      .getState()
      .upsertManual('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Manual');
    expect(hub?.destination_hash).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('lets announce set display name when no higher-priority name exists', () => {
    useRrcHubStore.getState().upsertFromEvent({
      destination_hash: 'dddddddddddddddddddddddddddddddd',
      display_name: 'LXMF Operator Name',
      source: 'discovered',
      name_source: 'announce',
    });
    expect(useRrcHubStore.getState().getHub('dddddddddddddddddddddddddddddddd')?.display_name).toBe(
      'LXMF Operator Name',
    );
  });

  it('applies WELCOME hub name over announce', () => {
    useRrcHubStore.getState().upsertFromEvent({
      destination_hash: 'cccccccccccccccccccccccccccccccc',
      display_name: 'LXMF Name',
      source: 'discovered',
      name_source: 'announce',
    });
    useRrcHubStore.getState().applyWelcomeName('cccccccccccccccccccccccccccccccc', 'RNS Community');
    expect(useRrcHubStore.getState().getHub('cccccccccccccccccccccccccccccccc')?.display_name).toBe(
      'RNS Community',
    );
  });
});
