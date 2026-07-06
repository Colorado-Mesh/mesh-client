import { describe, expect, it } from 'vitest';

import {
  buildDefaultTcpHubAddRequest,
  listMissingDefaultTcpHubs,
  RETICULUM_DEFAULT_TCP_HUBS,
  reticulumInterfaceMatchesTcpHub,
} from './reticulumDefaultTcpHubs';

describe('reticulumDefaultTcpHubs', () => {
  it('matches tcp interface by normalized host and port', () => {
    const hub = RETICULUM_DEFAULT_TCP_HUBS[0];
    expect(
      reticulumInterfaceMatchesTcpHub(
        { type: 'tcp', host: 'Reticulum.BetweenTheBorders.com', port: 4242 },
        hub,
      ),
    ).toBe(true);
    expect(
      reticulumInterfaceMatchesTcpHub(
        { type: 'tcp', host: '[reticulum.betweentheborders.com]', port: 4242 },
        hub,
      ),
    ).toBe(true);
    expect(
      reticulumInterfaceMatchesTcpHub({ type: 'udp', host: hub.host, port: hub.port }, hub),
    ).toBe(false);
    expect(reticulumInterfaceMatchesTcpHub({ type: 'tcp', host: hub.host, port: 4965 }, hub)).toBe(
      false,
    );
  });

  it('lists only hubs not already configured', () => {
    const dudeEth = RETICULUM_DEFAULT_TCP_HUBS[1];
    const missing = listMissingDefaultTcpHubs([
      {
        type: 'tcp',
        host: 'reticulum.betweentheborders.com',
        port: 4242,
      },
    ]);
    expect(missing).toEqual([dudeEth]);
    expect(listMissingDefaultTcpHubs([])).toEqual([...RETICULUM_DEFAULT_TCP_HUBS]);
    expect(
      listMissingDefaultTcpHubs([
        { type: 'tcp', host: 'reticulum.betweentheborders.com', port: 4242 },
        { type: 'tcp', host: 'rns.ratspeak.org', port: 4242 },
      ]),
    ).toEqual([]);
  });

  it('builds disabled tcp add request', () => {
    const hub = RETICULUM_DEFAULT_TCP_HUBS[1];
    expect(buildDefaultTcpHubAddRequest(hub)).toEqual({
      type: 'tcp',
      name: 'dude.eth',
      host: 'rns.ratspeak.org',
      port: 4242,
      enabled: false,
    });
  });
});
