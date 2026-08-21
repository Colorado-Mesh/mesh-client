import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import { MESHTASTIC_BROADCAST_NODE_NUM } from '@/shared/nodeNameUtils';

import {
  applyMeshtasticBroadcastTransportStatus,
  isMeshtasticBroadcastDestination,
  markMeshtasticBroadcastHeard,
  markMeshtasticBroadcastPending,
  markMeshtasticBroadcastTimeout,
} from './meshtasticHeardRepeat';

const ID = 'mt-id';

describe('meshtasticHeardRepeat', () => {
  beforeEach(() => {
    useRelayCoverageStore.setState({ coverage: {} });
  });

  afterEach(() => {
    useRelayCoverageStore.setState({ coverage: {} });
  });

  it('treats undefined and broadcast node as broadcast destinations', () => {
    expect(isMeshtasticBroadcastDestination(undefined)).toBe(true);
    expect(isMeshtasticBroadcastDestination(MESHTASTIC_BROADCAST_NODE_NUM)).toBe(true);
    expect(isMeshtasticBroadcastDestination(0x12345678)).toBe(false);
  });

  it('marks pending then ACK → broadcastHeard true', () => {
    markMeshtasticBroadcastPending(ID, 'temp-1');
    expect(useRelayCoverageStore.getState().coverageFor(ID, 'temp-1')?.broadcastHeard).toBeNull();
    markMeshtasticBroadcastHeard(ID, 'temp-1');
    expect(useRelayCoverageStore.getState().coverageFor(ID, 'temp-1')?.broadcastHeard).toBe(true);
  });

  it('marks pending then timeout → broadcastHeard false', () => {
    markMeshtasticBroadcastPending(ID, 'temp-1');
    markMeshtasticBroadcastTimeout(ID, 'temp-1');
    expect(useRelayCoverageStore.getState().coverageFor(ID, 'temp-1')?.broadcastHeard).toBe(false);
  });

  it('ignores ACK when no pending coverage (DM / uncorrelated)', () => {
    markMeshtasticBroadcastHeard(ID, 'dm-1');
    expect(useRelayCoverageStore.getState().coverageFor(ID, 'dm-1')).toBeUndefined();
  });

  it('MQTT transport status does not set heard', () => {
    markMeshtasticBroadcastPending(ID, 'temp-1');
    applyMeshtasticBroadcastTransportStatus({
      identityId: ID,
      transport: 'mqtt',
      status: 'acked',
      messageIdBefore: 'temp-1',
      messageIdAfter: 'temp-1',
    });
    expect(useRelayCoverageStore.getState().coverageFor(ID, 'temp-1')?.broadcastHeard).toBeNull();
  });

  it('renames coverage key on tempId → wire id then sets heard', () => {
    markMeshtasticBroadcastPending(ID, 'temp-1');
    applyMeshtasticBroadcastTransportStatus({
      identityId: ID,
      transport: 'device',
      status: 'acked',
      messageIdBefore: 'temp-1',
      messageIdAfter: 'wire-99',
    });
    expect(useRelayCoverageStore.getState().coverageFor(ID, 'temp-1')).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor(ID, 'wire-99')?.broadcastHeard).toBe(true);
  });

  it('still marks heard when coverage was already re-keyed by renameMessageId', () => {
    markMeshtasticBroadcastPending(ID, 'temp-1');
    useRelayCoverageStore.getState().renameMessage(ID, 'temp-1', 'wire-99');
    applyMeshtasticBroadcastTransportStatus({
      identityId: ID,
      transport: 'device',
      status: 'acked',
      messageIdBefore: 'temp-1',
      messageIdAfter: 'wire-99',
    });
    expect(useRelayCoverageStore.getState().coverageFor(ID, 'wire-99')?.broadcastHeard).toBe(true);
  });

  it('device fail sets timeout after rename', () => {
    markMeshtasticBroadcastPending(ID, 'temp-1');
    applyMeshtasticBroadcastTransportStatus({
      identityId: ID,
      transport: 'device',
      status: 'failed',
      messageIdBefore: 'temp-1',
      messageIdAfter: 'temp-1',
    });
    expect(useRelayCoverageStore.getState().coverageFor(ID, 'temp-1')?.broadcastHeard).toBe(false);
  });
});
