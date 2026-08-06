import { describe, expect, it } from 'vitest';

import { isMeshcoreTcpBurstDeadBridge } from './meshcoreTcpInitBurst';

describe('isMeshcoreTcpBurstDeadBridge', () => {
  it('is true only for tcp with burst captured and bridge dead', () => {
    expect(
      isMeshcoreTcpBurstDeadBridge({
        transportType: 'tcp',
        burstCaptured: true,
        bridgeDead: true,
      }),
    ).toBe(true);
    expect(
      isMeshcoreTcpBurstDeadBridge({
        transportType: 'ble',
        burstCaptured: true,
        bridgeDead: true,
      }),
    ).toBe(false);
    expect(
      isMeshcoreTcpBurstDeadBridge({
        transportType: 'tcp',
        burstCaptured: false,
        bridgeDead: true,
      }),
    ).toBe(false);
  });
});
