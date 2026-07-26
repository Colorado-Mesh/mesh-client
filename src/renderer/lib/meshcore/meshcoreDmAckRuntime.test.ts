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
    // Signed CRC and its u32 form are distinct Map keys — exercises multi-alias cleanup.
    const signedCrc = -42;
    const u32Crc = signedCrc >>> 0;
    const entry: PendingDmAckEntry = {
      timeoutId,
      mapKeys: [signedCrc, u32Crc],
      canonicalPacketIdU32: u32Crc,
      destNodeId: 7,
      pathHash: 'ab',
    };
    const pending = new Map<number, PendingDmAckEntry>([
      [signedCrc, entry],
      [u32Crc, entry],
    ]);
    expect(pending.size).toBe(2);
    const resolution = applyMeshcoreDmAckToPending(signedCrc, pending);
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

  it('does not apply ambiguous single-inflight DM ack fallback', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    addIdentity({
      id: ID,
      protocol: meshcoreProtocol,
      signature: 'meshcore:test:dm-ack-ambiguous',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    upsertMessage(ID, {
      id: 'temp-pending',
      from: 1,
      to: 99,
      payload: 'only one sending',
      channelIndex: -1,
      timestamp: Date.now(),
      status: 'sending',
    });
    expect(syncMeshcoreDmAckToMessageStore(ID, 42, 1, 'acked')).toBe(false);
    expect(useMessageStore.getState().messages[ID]?.['temp-pending']?.status).toBe('sending');
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('dropping unmatched DM ack'));
  });

  it('does not apply unmatched ack when multiple outbound DMs are in flight', () => {
    addIdentity({
      id: ID,
      protocol: meshcoreProtocol,
      signature: 'meshcore:test:dm-ack-multi',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    upsertMessage(ID, {
      id: '10',
      from: 1,
      to: 99,
      payload: 'a',
      channelIndex: -1,
      timestamp: Date.now(),
      status: 'sending',
    });
    upsertMessage(ID, {
      id: '11',
      from: 1,
      to: 100,
      payload: 'b',
      channelIndex: -1,
      timestamp: Date.now(),
      status: 'sending',
    });
    expect(syncMeshcoreDmAckToMessageStore(ID, 99, 1, 'acked')).toBe(false);
    expect(useMessageStore.getState().messages[ID]?.['10']?.status).toBe('sending');
    expect(useMessageStore.getState().messages[ID]?.['11']?.status).toBe('sending');
  });
});
