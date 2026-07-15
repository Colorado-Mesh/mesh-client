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
  RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS,
  RETICULUM_DEFAULT_HUB_PRESETS,
  reticulumInterfaceMatchesDecommissionedHub,
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
  const usEast = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'backbone-us-east')!;
  const i2p = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'backbone-i2p-a')!;

  it('matches tcp interface by normalized host and port', () => {
    expect(
      reticulumInterfaceMatchesHubPreset({ type: 'tcp', host: '45.77.109.86', port: 4965 }, usEast),
    ).toBe(true);
    expect(
      reticulumInterfaceMatchesHubPreset(
        { type: 'tcp', host: '[45.77.109.86]', port: 4965 },
        usEast,
      ),
    ).toBe(true);
    expect(
      reticulumInterfaceMatchesHubPreset(
        { type: 'udp', host: usEast.host, port: usEast.port },
        usEast,
      ),
    ).toBe(false);
    expect(
      reticulumInterfaceMatchesHubPreset({ type: 'tcp', host: usEast.host, port: 4242 }, usEast),
    ).toBe(false);
  });

  it('matches i2p interface by normalized peer address', () => {
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
    expect(
      reticulumInterfaceMatchesHubEndpoint({ host: '[45.77.109.86]', port: 4965 }, usEast),
    ).toBe(true);
    expect(reticulumInterfaceMatchesHubEndpoint({ host: usEast.host, port: 4242 }, usEast)).toBe(
      false,
    );
  });

  it('finds interface row by tcp endpoint', () => {
    const iface = row({
      id: 'u',
      type: 'udp',
      name: 'Custom',
      host: '45.77.109.86',
      port: 4965,
    });
    expect(findInterfaceForHubPresetEndpoint([iface], usEast)).toBe(iface);
  });

  it('builds repair patch for wrong name and type without enabled', () => {
    const patch = buildDefaultHubRepairPatch(
      {
        type: 'udp',
        name: 'Custom US East',
        host: usEast.host,
        port: usEast.port,
        mode: 'boundary',
      },
      usEast,
    );
    expect(patch).toEqual({
      name: 'RNS_Transport_US-East',
      type: 'tcp',
    });
    expect(patch).not.toHaveProperty('enabled');
  });

  it('returns null repair patch when fields match preset including mode', () => {
    expect(
      buildDefaultHubRepairPatch(
        {
          type: 'tcp',
          name: usEast.name,
          host: usEast.host,
          port: usEast.port,
          mode: 'boundary',
        },
        usEast,
      ),
    ).toBeNull();
  });

  it('repairs missing hub mode to boundary', () => {
    expect(
      buildDefaultHubRepairPatch(
        {
          type: 'tcp',
          name: usEast.name,
          host: usEast.host,
          port: usEast.port,
        },
        usEast,
      ),
    ).toEqual({ mode: 'boundary' });
  });

  it('does not overwrite a valid non-boundary hub mode', () => {
    expect(
      buildDefaultHubRepairPatch(
        {
          type: 'tcp',
          name: usEast.name,
          host: usEast.host,
          port: usEast.port,
          mode: 'gateway',
        },
        usEast,
      ),
    ).toBeNull();
  });

  it('plans skip when endpoint matches with a valid non-boundary mode', () => {
    const plan = planDefaultHubPresetsSync([
      row({
        id: 'us-east',
        type: 'tcp',
        name: usEast.name,
        host: usEast.host,
        port: usEast.port,
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
    expect(plan.disableDecommissioned).toEqual([]);
    expect(plan.skip).toContainEqual(usEast);
  });

  it('plans add for empty interfaces', () => {
    const plan = planDefaultHubPresetsSync([]);
    expect(plan.add).toEqual([...RETICULUM_DEFAULT_HUB_PRESETS]);
    expect(plan.repair).toEqual([]);
    expect(plan.skip).toEqual([]);
    expect(plan.disableDecommissioned).toEqual([]);
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
    expect(plan.disableDecommissioned).toEqual([]);
    expect(plan.skip).toEqual([...RETICULUM_DEFAULT_HUB_PRESETS]);
    expect(listMissingDefaultHubPresets(interfaces)).toEqual([]);
  });

  it('plans repair when endpoint matches but name differs', () => {
    const plan = planDefaultHubPresetsSync([
      row({
        id: 'us-east',
        type: 'tcp',
        name: 'My US East',
        host: usEast.host,
        port: usEast.port,
        mode: 'boundary',
      }),
    ]);
    expect(plan.repair).toHaveLength(1);
    expect(plan.repair[0]?.preset.id).toBe('backbone-us-east');
    expect(plan.repair[0]?.patch).toEqual({ name: 'RNS_Transport_US-East' });
    expect(plan.add).toHaveLength(4);
    const repairEntry = plan.repair[0];
    expect(repairEntry).toBeDefined();
    if (repairEntry) {
      expect(listMissingDefaultHubPresets([repairEntry.iface])).toHaveLength(4);
    }
  });

  it('plans disable for enabled decommissioned dublin/amsterdam/btb hubs', () => {
    const dublinEp = RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS.find(
      (e) => e.id === 'decommissioned-dublin',
    )!;
    const iface = row({
      id: 'dublin',
      type: 'tcp',
      name: 'RNS Testnet Dublin',
      host: 'dublin.connect.reticulum.network',
      port: 4965,
      enabled: true,
    });
    expect(reticulumInterfaceMatchesDecommissionedHub(iface, dublinEp)).toBe(true);
    const plan = planDefaultHubPresetsSync([
      iface,
      row({
        id: 'btb',
        type: 'tcp',
        name: 'RNS Testnet BetweenTheBorders',
        host: 'betweentheborders.com',
        port: 4242,
        enabled: true,
      }),
      row({
        id: 'ams',
        type: 'tcp',
        name: 'RNS Testnet Amsterdam',
        host: 'amsterdam.connect.reticulum.network',
        port: 4965,
        enabled: true,
      }),
    ]);
    expect(plan.disableDecommissioned.map((d) => d.endpoint.id).sort()).toEqual([
      'decommissioned-amsterdam',
      'decommissioned-betweentheborders',
      'decommissioned-dublin',
    ]);
    expect(plan.disableDecommissioned.every((d) => !d.patch.enabled)).toBe(true);
  });

  it('does not plan disable for already-disabled decommissioned hubs', () => {
    const plan = planDefaultHubPresetsSync([
      row({
        id: 'dublin',
        type: 'tcp',
        name: 'RNS Testnet Dublin',
        host: 'dublin.connect.reticulum.network',
        port: 4965,
        enabled: false,
      }),
    ]);
    expect(plan.disableDecommissioned).toEqual([]);
  });

  it('lists only presets with no endpoint configured', () => {
    const ratspeak = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'ratspeak')!;
    const rmap = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'rmap-world')!;
    const ygg = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'yggdrasil-ashburn-va')!;
    const missing = listMissingDefaultHubPresets([
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
        name: 'RNS I2P Hub A',
        host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
      },
    ]);
    expect(missing).toEqual([ygg, ratspeak, rmap]);
    expect(
      listMissingDefaultHubPresets([
        { id: 'u', type: 'tcp', name: 'RNS_Transport_US-East', host: '45.77.109.86', port: 4965 },
        {
          id: 'i',
          type: 'i2p',
          name: 'RNS I2P Hub A',
          host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
        },
        {
          id: 'y',
          type: 'tcp',
          name: 'Yggdrasil_Ashburn_VA',
          host: '201:ac2f:89eb:2afe:5f3d:9db9:a7e9:2f75',
          port: 4343,
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
      { id: 'u', type: 'tcp', name: 'RNS_Transport_US-East', host: '45.77.109.86', port: 4965 },
      {
        id: 'i',
        type: 'i2p',
        name: 'RNS I2P Hub A',
        host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
      },
      {
        id: 'y',
        type: 'tcp',
        name: 'Yggdrasil_Ashburn_VA',
        host: '201:ac2f:89eb:2afe:5f3d:9db9:a7e9:2f75',
        port: 4343,
      },
      { id: 'r', type: 'tcp', name: 'Ratspeak', host: 'rns.ratspeak.org', port: 4242 },
    ]);
    expect(missing).toEqual([rmap]);
  });

  it('includes yggdrasil ashburn va preset disabled by default', () => {
    const ygg = RETICULUM_DEFAULT_HUB_PRESETS.find((p) => p.id === 'yggdrasil-ashburn-va');
    expect(ygg).toMatchObject({
      name: 'Yggdrasil_Ashburn_VA',
      type: 'tcp',
      host: '201:ac2f:89eb:2afe:5f3d:9db9:a7e9:2f75',
      port: 4343,
    });
    expect(buildDefaultHubAddRequest(ygg!)).toEqual({
      type: 'tcp',
      name: 'Yggdrasil_Ashburn_VA',
      host: '201:ac2f:89eb:2afe:5f3d:9db9:a7e9:2f75',
      port: 4343,
      enabled: false,
      mode: 'boundary',
    });
  });

  it('builds disabled add requests for tcp and i2p', () => {
    expect(buildDefaultHubAddRequest(usEast)).toEqual({
      type: 'tcp',
      name: 'RNS_Transport_US-East',
      host: '45.77.109.86',
      port: 4965,
      enabled: false,
      mode: 'boundary',
    });
    expect(buildDefaultHubAddRequest(i2p)).toEqual({
      type: 'i2p',
      name: 'RNS I2P Hub A',
      host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
      enabled: false,
      mode: 'boundary',
    });
  });

  it('accepts official I2P backbone preset as addable', () => {
    expect(isDefaultHubPresetAddable(i2p)).toBe(true);
  });

  it('omits decommissioned dublin/btb from default presets', () => {
    expect(RETICULUM_DEFAULT_HUB_PRESETS.some((p) => p.host.includes('dublin'))).toBe(false);
    expect(RETICULUM_DEFAULT_HUB_PRESETS.some((p) => p.host.includes('betweentheborders'))).toBe(
      false,
    );
  });

  it('applyDefaultHubPresetsSync continues after repair failure', async () => {
    const proxyPut = vi.fn().mockResolvedValue({ ok: false, error: 'repair failed' });
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    const { result } = await applyDefaultHubPresetsSync(
      [
        row({
          id: 'us-east',
          type: 'tcp',
          name: 'Custom US East',
          host: usEast.host,
          port: usEast.port,
        }),
      ],
      { proxyPut, proxyPost },
    );
    expect(result.repaired).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.presetId).toBe('backbone-us-east');
    expect(proxyPost).toHaveBeenCalled();
    expect(result.added).toBeGreaterThan(0);
  });

  it('applyDefaultHubPresetsSync disables enabled decommissioned hubs', async () => {
    const proxyPut = vi.fn().mockResolvedValue({ ok: true });
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    const { result } = await applyDefaultHubPresetsSync(
      [
        row({
          id: 'dublin',
          type: 'tcp',
          name: 'RNS Testnet Dublin',
          host: 'dublin.connect.reticulum.network',
          port: 4965,
          enabled: true,
        }),
      ],
      { proxyPut, proxyPost },
    );
    expect(result.disabledDecommissioned).toBe(1);
    expect(proxyPut).toHaveBeenCalledWith('/api/v1/interfaces/dublin', { enabled: false });
    expect(result.added).toBe(RETICULUM_DEFAULT_HUB_PRESETS.length);
  });
});
