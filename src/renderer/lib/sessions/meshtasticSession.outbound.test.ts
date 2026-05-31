import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearMeshtasticOutboundTempId,
  resolveMeshtasticOutboundStoreKey,
  retargetMeshtasticOutboundTempId,
  trackMeshtasticOutboundTempId,
} from './meshtasticSession';

describe('meshtasticSession outbound store key tracking', () => {
  beforeEach(() => {
    clearMeshtasticOutboundTempId(42);
    clearMeshtasticOutboundTempId(99);
  });

  it('tracks tempId through PacketRouter echo re-key before mqtt ack', () => {
    trackMeshtasticOutboundTempId(42, '42');
    retargetMeshtasticOutboundTempId(42, '706820611');
    expect(resolveMeshtasticOutboundStoreKey(42, '42')).toBe('706820611');
  });

  it('falls back when tempId was never tracked', () => {
    expect(resolveMeshtasticOutboundStoreKey(99, '99')).toBe('99');
  });
});
