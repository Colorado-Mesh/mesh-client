import { describe, expect, it } from 'vitest';

import { disableDecommissionedReticulumHubsInConfigContent } from './reticulum-decommissioned-hubs';

describe('reticulum-decommissioned-hubs', () => {
  it('disables enabled dublin and betweentheborders TCP hubs', () => {
    const content = `# mesh-client-reticulum sidecar config

[reticulum]
enable_transport = Yes

[interfaces]

[[RNS Testnet Dublin]]
type = TCPClientInterface
interface_enabled = Yes
name = RNS Testnet Dublin
target_host = dublin.connect.reticulum.network
target_port = 4965

[[RNS Testnet BetweenTheBorders]]
type = TCPClientInterface
interface_enabled = Yes
name = RNS Testnet BetweenTheBorders
target_host = betweentheborders.com
target_port = 4242

[[RNS_Transport_US-East]]
type = TCPClientInterface
interface_enabled = Yes
target_host = 45.77.109.86
target_port = 4965

[[RNS HAM RADIO]]
type = TCPClientInterface
interface_enabled = Yes
target_host = 135.125.238.229
target_port = 4242
`;
    const { next, disabledNames } = disableDecommissionedReticulumHubsInConfigContent(content);
    expect(disabledNames.sort()).toEqual(['RNS Testnet BetweenTheBorders', 'RNS Testnet Dublin']);
    expect(next).toMatch(
      /\[\[RNS Testnet Dublin\]\][\s\S]*?interface_enabled = No[\s\S]*?target_host = dublin/,
    );
    expect(next).toMatch(
      /\[\[RNS Testnet BetweenTheBorders\]\][\s\S]*?interface_enabled = No[\s\S]*?target_host = betweentheborders/,
    );
    expect(next).toMatch(
      /\[\[RNS_Transport_US-East\]\][\s\S]*?interface_enabled = Yes[\s\S]*?45\.77\.109\.86/,
    );
    expect(next).toMatch(
      /\[\[RNS HAM RADIO\]\][\s\S]*?interface_enabled = Yes[\s\S]*?135\.125\.238\.229/,
    );
  });

  it('is a no-op when decommissioned hubs are already disabled', () => {
    const content = `[[RNS Testnet Dublin]]
type = TCPClientInterface
interface_enabled = No
target_host = dublin.connect.reticulum.network
target_port = 4965
`;
    const { next, disabledNames } = disableDecommissionedReticulumHubsInConfigContent(content);
    expect(disabledNames).toEqual([]);
    expect(next).toBe(content);
  });
});
