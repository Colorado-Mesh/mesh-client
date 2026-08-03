import { describe, expect, it } from 'vitest';

import { disableDecommissionedReticulumHubsInConfigContent } from './reticulum-decommissioned-hubs';

describe('reticulum-decommissioned-hubs', () => {
  it('disables enabled amsterdam TCP hubs and leaves live dublin/btb alone', () => {
    const content = `# mesh-client-reticulum sidecar config

[reticulum]
enable_transport = Yes

[interfaces]

[[RNS Testnet Amsterdam]]
type = TCPClientInterface
interface_enabled = Yes
name = RNS Testnet Amsterdam
target_host = amsterdam.connect.reticulum.network
target_port = 4965

[[RNS Dublin Mainnet]]
type = TCPClientInterface
interface_enabled = Yes
name = RNS Dublin Mainnet
target_host = dublin.connect.reticulum.network
target_port = 4965

[[RNS Between The Borders]]
type = TCPClientInterface
interface_enabled = Yes
name = RNS Between The Borders
target_host = reticulum.betweentheborders.com
target_port = 4242

[[RNS_Transport_US-East]]
type = TCPClientInterface
interface_enabled = Yes
target_host = 45.77.109.86
target_port = 4965
`;
    const { next, disabledNames } = disableDecommissionedReticulumHubsInConfigContent(content);
    expect(disabledNames).toEqual(['RNS Testnet Amsterdam']);
    expect(next).toMatch(
      /\[\[RNS Testnet Amsterdam\]\][\s\S]*?interface_enabled = No[\s\S]*?target_host = amsterdam/,
    );
    expect(next).toMatch(
      /\[\[RNS Dublin Mainnet\]\][\s\S]*?interface_enabled = Yes[\s\S]*?target_host = dublin/,
    );
    expect(next).toMatch(
      /\[\[RNS Between The Borders\]\][\s\S]*?interface_enabled = Yes[\s\S]*?betweentheborders/,
    );
    expect(next).toMatch(
      /\[\[RNS_Transport_US-East\]\][\s\S]*?interface_enabled = Yes[\s\S]*?45\.77\.109\.86/,
    );
  });

  it('is a no-op when decommissioned hubs are already disabled', () => {
    const content = `[[RNS Testnet Amsterdam]]
type = TCPClientInterface
interface_enabled = No
target_host = amsterdam.connect.reticulum.network
target_port = 4965
`;
    const { next, disabledNames } = disableDecommissionedReticulumHubsInConfigContent(content);
    expect(disabledNames).toEqual([]);
    expect(next).toBe(content);
  });
});
