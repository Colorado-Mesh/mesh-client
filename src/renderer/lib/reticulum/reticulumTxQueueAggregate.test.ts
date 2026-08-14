import { describe, expect, it } from 'vitest';

import {
  aggregateReticulumLocalRfTxQueue,
  type ReticulumTxQueueIfaceInput,
} from './reticulumTxQueueAggregate';

function row(
  partial: Partial<ReticulumTxQueueIfaceInput> & Pick<ReticulumTxQueueIfaceInput, 'name' | 'type'>,
): ReticulumTxQueueIfaceInput {
  return {
    enabled: true,
    status: 'up',
    tx_queue_used: 0,
    tx_queue_max: 256,
    ...partial,
  };
}

describe('aggregateReticulumLocalRfTxQueue', () => {
  it('returns null for empty or missing interfaces', () => {
    expect(aggregateReticulumLocalRfTxQueue(null)).toBeNull();
    expect(aggregateReticulumLocalRfTxQueue(undefined)).toBeNull();
    expect(aggregateReticulumLocalRfTxQueue([])).toBeNull();
  });

  it('returns null when all RF interfaces are offline or disabled', () => {
    expect(
      aggregateReticulumLocalRfTxQueue([
        row({ name: 'RNode A', type: 'rnode', status: 'down', tx_queue_used: 200 }),
        row({ name: 'RNode B', type: 'rnode', enabled: false, tx_queue_used: 200 }),
      ]),
    ).toBeNull();
  });

  it('aggregates a single online BLE RNode at empty fill', () => {
    expect(
      aggregateReticulumLocalRfTxQueue([
        row({
          name: 'RNode 41F4',
          type: 'rnode',
          tx_queue_used: 0,
          tx_queue_max: 256,
        }),
      ]),
    ).toEqual({
      free: 256,
      maxlen: 256,
      res: 0,
      interfaceName: 'RNode 41F4',
      buffering: false,
    });
  });

  it('aggregates a single RNode with partial fill', () => {
    expect(
      aggregateReticulumLocalRfTxQueue([
        row({ name: 'RNode USB', type: 'rnode', tx_queue_used: 64, tx_queue_max: 256 }),
      ]),
    ).toEqual({
      free: 192,
      maxlen: 256,
      res: 0,
      interfaceName: 'RNode USB',
      buffering: true,
    });
  });

  it('picks the worst fill ratio across two RF interfaces', () => {
    const agg = aggregateReticulumLocalRfTxQueue([
      row({ name: 'RNode A', type: 'rnode', tx_queue_used: 10, tx_queue_max: 256 }),
      row({ name: 'RNode B', type: 'rnode', tx_queue_used: 200, tx_queue_max: 256 }),
    ]);
    expect(agg?.interfaceName).toBe('RNode B');
    expect(agg?.free).toBe(56);
    expect(agg?.maxlen).toBe(256);
    expect(agg?.buffering).toBe(true);
  });

  it('tie-breaks equal ratios by higher used, then name', () => {
    const byUsed = aggregateReticulumLocalRfTxQueue([
      row({ name: 'Zebra', type: 'rnode', tx_queue_used: 512, tx_queue_max: 1024 }),
      row({ name: 'Alpha', type: 'rnode', tx_queue_used: 128, tx_queue_max: 256 }),
    ]);
    expect(byUsed?.interfaceName).toBe('Zebra');
    expect(byUsed?.maxlen).toBe(1024);
    expect(byUsed?.free).toBe(512);

    const byName = aggregateReticulumLocalRfTxQueue([
      row({ name: 'Zebra', type: 'rnode', tx_queue_used: 128, tx_queue_max: 256 }),
      row({ name: 'Alpha', type: 'rnode', tx_queue_used: 128, tx_queue_max: 256 }),
    ]);
    expect(byName?.interfaceName).toBe('Alpha');
  });

  it('rejects non-finite queue statistics', () => {
    expect(
      aggregateReticulumLocalRfTxQueue([
        row({ name: 'NaN', type: 'rnode', tx_queue_used: Number.NaN, tx_queue_max: 256 }),
        row({
          name: 'Inf',
          type: 'rnode',
          tx_queue_used: 10,
          tx_queue_max: Number.POSITIVE_INFINITY,
        }),
      ]),
    ).toBeNull();
  });

  it('ignores fuller TCP hubs and picks the local RF interface', () => {
    const agg = aggregateReticulumLocalRfTxQueue([
      row({ name: 'RMAP World', type: 'tcp', tx_queue_used: 900, tx_queue_max: 1024 }),
      row({ name: 'Heltec USB', type: 'rnode', tx_queue_used: 40, tx_queue_max: 256 }),
    ]);
    expect(agg?.interfaceName).toBe('Heltec USB');
    expect(agg?.maxlen).toBe(256);
  });

  it('includes kiss and rnode_multi; excludes Auto and I2P', () => {
    const agg = aggregateReticulumLocalRfTxQueue([
      row({ name: 'Auto', type: 'auto', tx_queue_used: 200, tx_queue_max: 256 }),
      row({ name: 'I2P Hub', type: 'i2p', tx_queue_used: 200, tx_queue_max: 256 }),
      row({ name: 'KISS', type: 'kiss', tx_queue_used: 5, tx_queue_max: 256 }),
      row({ name: 'Multi', type: 'rnode_multi', tx_queue_used: 50, tx_queue_max: 256 }),
    ]);
    expect(agg?.interfaceName).toBe('Multi');
    expect(agg?.buffering).toBe(true);
  });

  it('skips rows with missing or zero max', () => {
    expect(
      aggregateReticulumLocalRfTxQueue([
        row({ name: 'NoMax', type: 'rnode', tx_queue_used: 10, tx_queue_max: null }),
        row({ name: 'ZeroMax', type: 'rnode', tx_queue_used: 10, tx_queue_max: 0 }),
      ]),
    ).toBeNull();
  });

  it('sets buffering when any scoped interface has used > 0', () => {
    const agg = aggregateReticulumLocalRfTxQueue([
      row({ name: 'Idle', type: 'rnode', tx_queue_used: 0, tx_queue_max: 256 }),
      row({ name: 'Busy', type: 'rnode', tx_queue_used: 1, tx_queue_max: 256 }),
    ]);
    expect(agg?.buffering).toBe(true);
    expect(agg?.interfaceName).toBe('Busy');
  });
});
