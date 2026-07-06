import { describe, expect, it } from 'vitest';

import {
  buildDefaultHubAddRequest,
  listMissingDefaultHubPresets,
  RETICULUM_DEFAULT_HUB_PRESETS,
  reticulumInterfaceMatchesHubPreset,
} from './reticulumDefaultHubPresets';

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

  it('lists only presets not already configured', () => {
    const ratspeak = RETICULUM_DEFAULT_HUB_PRESETS[4];
    const missing = listMissingDefaultHubPresets([
      {
        type: 'tcp',
        host: 'dublin.connect.reticulum.network',
        port: 4965,
      },
      {
        type: 'tcp',
        host: 'reticulum.betweentheborders.com',
        port: 4242,
      },
      {
        type: 'tcp',
        host: '45.77.109.86',
        port: 4965,
      },
      {
        type: 'i2p',
        host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
        port: undefined,
      },
    ]);
    expect(missing).toEqual([ratspeak]);
    expect(listMissingDefaultHubPresets([])).toEqual([...RETICULUM_DEFAULT_HUB_PRESETS]);
    expect(
      listMissingDefaultHubPresets([
        { type: 'tcp', host: 'dublin.connect.reticulum.network', port: 4965 },
        { type: 'tcp', host: 'reticulum.betweentheborders.com', port: 4242 },
        { type: 'tcp', host: '45.77.109.86', port: 4965 },
        { type: 'i2p', host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p' },
        { type: 'tcp', host: 'rns.ratspeak.org', port: 4242 },
      ]),
    ).toEqual([]);
  });

  it('builds disabled add requests for tcp and i2p', () => {
    const dublin = RETICULUM_DEFAULT_HUB_PRESETS[0];
    expect(buildDefaultHubAddRequest(dublin)).toEqual({
      type: 'tcp',
      name: 'RNS Testnet Dublin',
      host: 'dublin.connect.reticulum.network',
      port: 4965,
      enabled: false,
    });
    const i2p = RETICULUM_DEFAULT_HUB_PRESETS[3];
    expect(buildDefaultHubAddRequest(i2p)).toEqual({
      type: 'i2p',
      name: 'RNS Testnet I2P Hub A',
      host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
      enabled: false,
    });
  });
});
