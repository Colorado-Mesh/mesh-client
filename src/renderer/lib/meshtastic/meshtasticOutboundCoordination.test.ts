import { afterEach, describe, expect, it } from 'vitest';

import {
  beginMeshtasticNonChatOutbound,
  endMeshtasticNonChatOutbound,
  hasMeshtasticNonChatOutboundInFlight,
  isMeshtasticNonChatWirePacketId,
  registerMeshtasticNonChatWirePacketId,
  resetMeshtasticOutboundCoordinationForTests,
} from './meshtasticOutboundCoordination';

describe('meshtasticOutboundCoordination', () => {
  afterEach(() => {
    resetMeshtasticOutboundCoordinationForTests();
  });

  it('tracks non-chat outbound in-flight count', () => {
    expect(hasMeshtasticNonChatOutboundInFlight()).toBe(false);
    beginMeshtasticNonChatOutbound();
    expect(hasMeshtasticNonChatOutboundInFlight()).toBe(true);
    beginMeshtasticNonChatOutbound();
    endMeshtasticNonChatOutbound();
    expect(hasMeshtasticNonChatOutboundInFlight()).toBe(true);
    endMeshtasticNonChatOutbound();
    expect(hasMeshtasticNonChatOutboundInFlight()).toBe(false);
  });

  it('does not let end underflow the in-flight count', () => {
    endMeshtasticNonChatOutbound();
    expect(hasMeshtasticNonChatOutboundInFlight()).toBe(false);
  });

  it('registers settled non-chat wire ids for late log-echo skips', () => {
    expect(isMeshtasticNonChatWirePacketId(883268679)).toBe(false);
    registerMeshtasticNonChatWirePacketId(883268679);
    expect(isMeshtasticNonChatWirePacketId(883268679)).toBe(true);
    expect(isMeshtasticNonChatWirePacketId(1)).toBe(false);
  });

  it('ignores null/undefined wire ids on register', () => {
    registerMeshtasticNonChatWirePacketId(null);
    registerMeshtasticNonChatWirePacketId(undefined);
    expect(isMeshtasticNonChatWirePacketId(0)).toBe(false);
  });
});
