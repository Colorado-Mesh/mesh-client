import { beforeEach, describe, expect, it } from 'vitest';

import { useRncpTransferStore } from './rncpTransferStore';

const DEST = 'b'.repeat(32);

describe('rncpTransferStore', () => {
  beforeEach(() => {
    useRncpTransferStore.getState().clearAll();
  });

  it('starts a transfer and applies progress', () => {
    const store = useRncpTransferStore.getState();
    store.startTransfer({
      transfer_id: 't1',
      kind: 'send',
      destination_hash: DEST,
      file_name: 'a.txt',
    });
    expect(useRncpTransferStore.getState().transfers.get('t1')?.status).toBe('active');

    store.applyProgress('t1', 42);
    expect(useRncpTransferStore.getState().transfers.get('t1')?.progress).toBe(42);

    store.applyProgress('t1', 150);
    expect(useRncpTransferStore.getState().transfers.get('t1')?.progress).toBe(100);
  });

  it('applies completion and clears any matching pending offer', () => {
    const store = useRncpTransferStore.getState();
    store.applyOffer({ transfer_id: 't1', file_name: 'a.txt', bytes: 10, identity_hash: 'id1' });
    expect(useRncpTransferStore.getState().pendingOffers.has('t1')).toBe(true);

    store.applyCompleted({
      transfer_id: 't1',
      file_name: 'a.txt',
      bytes: 10,
      path: '/tmp/a.txt',
      identity_hash: 'id1',
    });
    const transfer = useRncpTransferStore.getState().transfers.get('t1');
    expect(transfer?.status).toBe('completed');
    expect(transfer?.progress).toBe(100);
    expect(useRncpTransferStore.getState().pendingOffers.has('t1')).toBe(false);
  });

  it('applies failure with a reason and preserves retry args for manual retry', () => {
    const store = useRncpTransferStore.getState();
    store.startTransfer({
      transfer_id: 't1',
      kind: 'send',
      destination_hash: DEST,
      file_name: 'a.txt',
      retryArgs: { path: '/tmp/a.txt' },
    });
    store.applyFailed({ transfer_id: 't1', error: 'boom', reason: 'timeout' });
    const transfer = useRncpTransferStore.getState().transfers.get('t1');
    expect(transfer?.status).toBe('failed');
    expect(transfer?.error).toBe('boom');
    expect(transfer?.reason_key).toBe('timeout');
    expect(transfer?.retryArgs).toEqual({ path: '/tmp/a.txt' });
  });

  it('increments the retry counter on each retry attempt', () => {
    const store = useRncpTransferStore.getState();
    store.startTransfer({ transfer_id: 't1', kind: 'send', destination_hash: DEST });
    expect(store.incrementRetry('t1')).toBe(1);
    expect(store.incrementRetry('t1')).toBe(2);
    expect(useRncpTransferStore.getState().transfers.get('t1')?.retryCount).toBe(2);
  });

  it('applies cancellation and clears a pending offer for the same transfer', () => {
    const store = useRncpTransferStore.getState();
    store.applyOffer({ transfer_id: 't1', file_name: 'a.txt', bytes: 10 });
    store.applyCancelled({ transfer_id: 't1', reason: 'rejected' });
    const transfer = useRncpTransferStore.getState().transfers.get('t1');
    expect(transfer?.status).toBe('cancelled');
    expect(useRncpTransferStore.getState().pendingOffers.has('t1')).toBe(false);
  });

  it('tracks pending offers and removes them independently of transfers', () => {
    const store = useRncpTransferStore.getState();
    store.applyOffer({ transfer_id: 't1', file_name: 'a.txt', bytes: 10 });
    store.applyOffer({ transfer_id: 't2', file_name: 'b.txt', bytes: 20 });
    expect(useRncpTransferStore.getState().pendingOffers.size).toBe(2);
    store.removeOffer('t1');
    expect(useRncpTransferStore.getState().pendingOffers.size).toBe(1);
    expect(useRncpTransferStore.getState().pendingOffers.has('t2')).toBe(true);
  });

  it('tracks listener status and supports an optimistic inbound-mode update', () => {
    const store = useRncpTransferStore.getState();
    store.setListener({
      enabled: true,
      inbound_mode: 'ask',
      allowed: [],
      blocked: [],
    });
    store.setInboundModeOptimistic('off');
    expect(useRncpTransferStore.getState().listener?.inbound_mode).toBe('off');
  });

  it('clearAll resets transfers, offers, and listener status', () => {
    const store = useRncpTransferStore.getState();
    store.startTransfer({ transfer_id: 't1', kind: 'send', destination_hash: DEST });
    store.applyOffer({ transfer_id: 't2', file_name: 'b.txt', bytes: 20 });
    store.setListener({ enabled: true, inbound_mode: 'ask', allowed: [], blocked: [] });
    store.clearAll();
    const state = useRncpTransferStore.getState();
    expect(state.transfers.size).toBe(0);
    expect(state.pendingOffers.size).toBe(0);
    expect(state.listener).toBeNull();
  });
});
