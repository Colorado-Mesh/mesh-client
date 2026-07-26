import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PendingDmAckEntry } from '../../hooks/meshcore/meshcoreHookPreamble';
import { addIdentity } from '../../stores/identityStore';
import { upsertMessage, useMessageStore } from '../../stores/messageStore';
import { meshcoreProtocol } from '../protocols/MeshCoreProtocol';
import {
  applyMeshcoreDmAckToPending,
  resolveMeshcoreDmAck,
  syncMeshcoreDmAckToMessageStore,
} from './meshcoreDmAckRuntime';

const ID = 'meshcore-dm-ack-runtime-test';

describe('meshcoreDmAckRuntime', () => {
  afterEach(() => {
    useMessageStore.setState({ messages: {} });
    vi.restoreAllMocks();
  });

  it('resolveMeshcoreDmAck marks NACK codes as failed', () => {
    const pending = new Map<number, PendingDmAckEntry>();
    expect(resolveMeshcoreDmAck(0x81, pending).newStatus).toBe('failed');
    expect(resolveMeshcoreDmAck(129, pending).newStatus).toBe('failed');
    expect(resolveMeshcoreDmAck(0x80, pending).newStatus).toBe('acked');
  });

  it('applyMeshcoreDmAckToPending clears matching pending entry', () => {
    const timeoutId = setTimeout(() => {}, 60_000);
    const entry: PendingDmAckEntry = {
      timeoutId,
      mapKeys: [42, 42 >>> 0],
      canonicalPacketIdU32: 42,
      destNodeId: 7,
      pathHash: 'ab',
    };
    const pending = new Map<number, PendingDmAckEntry>([
      [42, entry],
      [42 >>> 0, entry],
    ]);
    const resolution = applyMeshcoreDmAckToPending(42, pending);
    expect(resolution.pending).toBe(entry);
    expect(resolution.newStatus).toBe('acked');
    expect(pending.size).toBe(0);
    clearTimeout(timeoutId);
  });

  it('syncMeshcoreDmAckToMessageStore updates sending outbound by ack key', () => {
    addIdentity({
      id: ID,
      protocol: meshcoreProtocol,
      signature: 'meshcore:test:dm-ack',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    upsertMessage(ID, {
      id: '42',
      from: 1,
      to: 99,
      payload: 'hi',
      channelIndex: -1,
      timestamp: Date.now(),
      status: 'sending',
    });
    expect(syncMeshcoreDmAckToMessageStore(ID, 42, 1, 'acked')).toBe(true);
    expect(useMessageStore.getState().messages[ID]?.['42']?.status).toBe('acked');
  });
});
