import { describe, expect, it, vi } from 'vitest';

import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';

import {
  applyDefaultHubPresetsSync,
  buildDefaultHubAddRequest,
  buildDefaultHubRepairPatch,
  findInterfaceForHubPresetEndpoint,
  isDefaultHubPresetAddable,
  listMissingDefaultHubPresets,
  planDefaultHubPresetsSync,
  RETICULUM_DEFAULT_HUB_PRESETS,
  reticulumInterfaceMatchesHubEndpoint,
  reticulumInterfaceMatchesHubPreset,
} from './reticulumDefaultHubPresets';

function row(
  partial: Pick<ReticulumInterfaceRow, 'id' | 'type' | 'name' | 'host' | 'port'> &
    Partial<ReticulumInterfaceRow>,
): ReticulumInterfaceRow {
  return {
    enabled: false,
    status: 'down',
    ...partial,
  };
}

describe('reticulumDefaultHubPresets', () => {
  it('matches tcp interface by normalized host and port', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    expect(
      reticulumInterfaceMatchesHubPreset(
        { type: 'tcp', host: 'Dublin.Connect.Reticulum.Network', port: 4965 },
        dublin,
      ),
    ).toBe(true);
    expect(
      reticulumInterfaceMatchesHubPreset(
        { type: 'tcp', host: '[dublin.connect.reticulum.network]', port: 4965 },
        dublin,
      ),
    ).toBe(true);
    expect(
      reticulumInterfaceMatchesHubPreset(
        { type: 'udp', host: dublin.host, port: dublin.port },
        dublin,
      ),
    ).toBe(false);
    expect(
      reticulumInterfaceMatchesHubPreset({ type: 'tcp', host: dublin.host, port: 4242 }, dublin),
    ).toBe(false);
  });

  it('matches i2p interface by normalized peer address', () => {
    const i2p = RETICULUM_DEFAULT_HUB_PRESETS[3];
    expect(
      reticulumInterfaceMatchesHubPreset(
        {
          type: 'i2p',
          host: 'G3BR23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
          port: undefined,
        },
        i2p,
      ),
    ).toBe(true);
    expect(
      reticulumInterfaceMatchesHubPreset({ type: 'tcp', host: i2p.host, port: 4242 }, i2p),
    ).toBe(false);
  });

  it('matches tcp endpoint by host and port regardless of type', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    expect(
      reticulumInterfaceMatchesHubEndpoint(
        { host: '[dublin.connect.reticulum.network]', port: 4965 },
        dublin,
      ),
    ).toBe(true);
    expect(reticulumInterfaceMatchesHubEndpoint({ host: dublin.host, port: 4242 }, dublin)).toBe(
      false,
    );
  });

  it('finds interface row by tcp endpoint', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    const iface = row({
      id: 'd',
      type: 'udp',
      name: 'Custom',
      host: 'dublin.connect.reticulum.network',
      port: 4965,
    });
    expect(findInterfaceForHubPresetEndpoint([iface], dublin)).toBe(iface);
  });

  it('builds repair patch for wrong name and type without enabled', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    const patch = buildDefaultHubRepairPatch(
      {
        type: 'udp',
        name: 'Custom Dublin',
        host: dublin.host,
        port: dublin.port,
        mode: 'boundary',
      },
      dublin,
    );
    expect(patch).toEqual({
      name: 'RNS Testnet Dublin',
      type: 'tcp',
    });
    expect(patch).not.toHaveProperty('enabled');
  });

  it('returns null repair patch when fields match preset including mode', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    expect(
      buildDefaultHubRepairPatch(
        {
          type: 'tcp',
          name: dublin.name,
          host: dublin.host,
          port: dublin.port,
          mode: 'boundary',
        },
        dublin,
      ),
    ).toBeNull();
  });

  it('repairs missing hub mode to boundary', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    expect(
      buildDefaultHubRepairPatch(
        {
          type: 'tcp',
          name: dublin.name,
          host: dublin.host,
          port: dublin.port,
        },
        dublin,
      ),
    ).toEqual({ mode: 'boundary' });
  });

  it('does not overwrite a valid non-boundary hub mode', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    expect(
      buildDefaultHubRepairPatch(
        {
          type: 'tcp',
          name: dublin.name,
          host: dublin.host,
          port: dublin.port,
          mode: 'gateway',
        },
        dublin,
      ),
    ).toBeNull();
  });

  it('plans skip when endpoint matches with a valid non-boundary mode', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    const plan = planDefaultHubPresetsSync([
      row({
        id: 'dublin',
        type: 'tcp',
        name: dublin.name,
        host: dublin.host,
        port: dublin.port,
        mode: 'gateway',
      }),
      ...RETICULUM_DEFAULT_HUB_PRESETS.slice(1).map((preset, index) =>
        row({
          id: `hub-${index}`,
          type: preset.type,
          name: preset.name,
          host: preset.host,
          port: preset.port,
          mode: 'boundary',
        }),
      ),
    ]);
    expect(plan.repair).toEqual([]);
    expect(plan.add).toEqual([]);
    expect(plan.skip).toContainEqual(dublin);
  });

  it('plans add for empty interfaces', () => {
    const plan = planDefaultHubPresetsSync([]);
    expect(plan.add).toEqual([...RETICULUM_DEFAULT_HUB_PRESETS]);
    expect(plan.repair).toEqual([]);
    expect(plan.skip).toEqual([]);
    expect(listMissingDefaultHubPresets([])).toEqual([...RETICULUM_DEFAULT_HUB_PRESETS]);
  });

  it('plans skip when all presets fully match', () => {
    const interfaces = RETICULUM_DEFAULT_HUB_PRESETS.map((preset, index) =>
      row({
        id: `hub-${index}`,
        type: preset.type,
        name: preset.name,
        host: preset.host,
        port: preset.port,
        mode: 'boundary',
      }),
    );
    const plan = planDefaultHubPresetsSync(interfaces);
    expect(plan.add).toEqual([]);
    expect(plan.repair).toEqual([]);
    expect(plan.skip).toEqual([...RETICULUM_DEFAULT_HUB_PRESETS]);
    expect(listMissingDefaultHubPresets(interfaces)).toEqual([]);
  });

  it('plans repair when endpoint matches but name differs', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    const plan = planDefaultHubPresetsSync([
      row({
        id: 'dublin',
        type: 'tcp',
        name: 'My Dublin',
        host: dublin.host,
        port: dublin.port,
        mode: 'boundary',
      }),
    ]);
    expect(plan.repair).toHaveLength(1);
    expect(plan.repair[0]?.preset.id).toBe('testnet-dublin');
    expect(plan.repair[0]?.patch).toEqual({ name: 'RNS Testnet Dublin' });
    expect(plan.add).toHaveLength(5);
    const repairEntry = plan.repair[0];
    expect(repairEntry).toBeDefined();
    if (repairEntry) {
      expect(listMissingDefaultHubPresets([repairEntry.iface])).toHaveLength(5);
    }
  });

  it('lists only presets with no endpoint configured', () => {
    const ratspeak = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'ratspeak')!;
    const rmap = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'rmap-world')!;
    const missing = listMissingDefaultHubPresets([
      {
        id: 'dublin',
        type: 'tcp',
        name: 'RNS Testnet Dublin',
        host: 'dublin.connect.reticulum.network',
        port: 4965,
      },
      {
        id: 'btb',
        type: 'tcp',
        name: 'RNS Testnet BetweenTheBorders',
        host: 'reticulum.betweentheborders.com',
        port: 4242,
      },
      {
        id: 'us-east',
        type: 'tcp',
        name: 'RNS_Transport_US-East',
        host: '45.77.109.86',
        port: 4965,
      },
      {
        id: 'i2p',
        type: 'i2p',
        name: 'RNS Testnet I2P Hub A',
        host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
      },
    ]);
    expect(missing).toEqual([ratspeak, rmap]);
    expect(
      listMissingDefaultHubPresets([
        {
          id: 'd',
          type: 'tcp',
          name: 'RNS Testnet Dublin',
          host: 'dublin.connect.reticulum.network',
          port: 4965,
        },
        {
          id: 'b',
          type: 'tcp',
          name: 'RNS Testnet BetweenTheBorders',
          host: 'reticulum.betweentheborders.com',
          port: 4242,
        },
        { id: 'u', type: 'tcp', name: 'RNS_Transport_US-East', host: '45.77.109.86', port: 4965 },
        {
          id: 'i',
          type: 'i2p',
          name: 'RNS Testnet I2P Hub A',
          host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
        },
        { id: 'r', type: 'tcp', name: 'Ratspeak', host: 'rns.ratspeak.org', port: 4242 },
        { id: 'm', type: 'tcp', name: 'RMAP World', host: 'rmap.world', port: 4242 },
      ]),
    ).toEqual([]);
  });

  it('includes rmap.world preset and matches host/port', () => {
    const rmap = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'rmap-world');
    expect(rmap).toMatchObject({ host: 'rmap.world', port: 4242, type: 'tcp' });
    expect(
      reticulumInterfaceMatchesHubPreset({ type: 'tcp', host: 'rmap.world', port: 4242 }, rmap!),
    ).toBe(true);
    expect(buildDefaultHubAddRequest(rmap!)).toEqual({
      type: 'tcp',
      name: 'RMAP World',
      host: 'rmap.world',
      port: 4242,
      enabled: false,
      mode: 'boundary',
    });
  });

  it('lists rmap-world when other presets present', () => {
    const rmap = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'rmap-world')!;
    const missing = listMissingDefaultHubPresets([
      {
        id: 'd',
        type: 'tcp',
        name: 'RNS Testnet Dublin',
        host: 'dublin.connect.reticulum.network',
        port: 4965,
      },
      {
        id: 'b',
        type: 'tcp',
        name: 'RNS Testnet BetweenTheBorders',
        host: 'reticulum.betweentheborders.com',
        port: 4242,
      },
      { id: 'u', type: 'tcp', name: 'RNS_Transport_US-East', host: '45.77.109.86', port: 4965 },
      {
        id: 'i',
        type: 'i2p',
        name: 'RNS Testnet I2P Hub A',
        host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
      },
      { id: 'r', type: 'tcp', name: 'Ratspeak', host: 'rns.ratspeak.org', port: 4242 },
    ]);
    expect(missing).toEqual([rmap]);
  });

  it('builds disabled add requests for tcp and i2p', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    expect(buildDefaultHubAddRequest(dublin)).toEqual({
      type: 'tcp',
      name: 'RNS Testnet Dublin',
      host: 'dublin.connect.reticulum.network',
      port: 4965,
      enabled: false,
      mode: 'boundary',
    });
    const i2p = RETICULUM_DEFAULT_HUB_PRESETS[3];
    expect(buildDefaultHubAddRequest(i2p)).toEqual({
      type: 'i2p',
      name: 'RNS Testnet I2P Hub A',
      host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
      enabled: false,
      mode: 'boundary',
    });
  });

  it('accepts official I2P testnet preset as addable', () => {
    const i2p = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'testnet-i2p-a')!;
    expect(isDefaultHubPresetAddable(i2p)).toBe(true);
  });

  it('applyDefaultHubPresetsSync continues after repair failure', async () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    const proxyPut = vi.fn().mockResolvedValue({ ok: false, error: 'repair failed' });
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    const { result } = await applyDefaultHubPresetsSync(
      [
        row({
          id: 'dublin',
          type: 'tcp',
          name: 'Custom Dublin',
          host: dublin.host,
          port: dublin.port,
        }),
      ],
      { proxyPut, proxyPost },
    );
    expect(result.repaired).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.presetId).toBe('testnet-dublin');
    expect(proxyPost).toHaveBeenCalled();
    expect(result.added).toBeGreaterThan(0);
  });
});
