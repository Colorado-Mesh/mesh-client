import { describe, expect, it } from 'vitest';

import {
  composeMeshcomFirmwareMsgId,
  meshcomMsgIdAdvance,
  meshcomRoutingAckMatchesOutbound,
} from './meshcomFwMsgId';

describe('meshcomFwMsgId', () => {
  it('composes gw prefix and seq like firmware', () => {
    expect(composeMeshcomFirmwareMsgId(0x123456, 42)).toBe(((0x123456 & 0x3fffff) << 10) | 42);
  });

  it('wraps msgIdAdvance at 999', () => {
    expect(meshcomMsgIdAdvance(999)).toBe(0);
    expect(meshcomMsgIdAdvance(42)).toBe(43);
  });

  it('matches KISS ackNN against full outbound id sharing low seq', () => {
    const outbound = composeMeshcomFirmwareMsgId(0x0a0b0c, 12);
    expect(meshcomRoutingAckMatchesOutbound(outbound, 12)).toBe(true);
    expect(meshcomRoutingAckMatchesOutbound(outbound, 13)).toBe(false);
  });

  it('matches full firmware ids', () => {
    const id = composeMeshcomFirmwareMsgId(0xabcdef, 5);
    expect(meshcomRoutingAckMatchesOutbound(id, id)).toBe(true);
  });
});
