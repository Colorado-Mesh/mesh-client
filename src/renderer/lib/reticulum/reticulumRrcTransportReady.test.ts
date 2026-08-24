import { describe, expect, it } from 'vitest';

import { evaluateReticulumRrcTransportReady } from '@/renderer/lib/reticulum/reticulumRrcTransportReady';
import type { ReticulumSidecarInterfaceRow } from '@/renderer/lib/reticulum/reticulumSidecarReads';

function row(
  partial: Partial<ReticulumSidecarInterfaceRow> & Pick<ReticulumSidecarInterfaceRow, 'type'>,
): ReticulumSidecarInterfaceRow {
  return {
    id: partial.id ?? 'id',
    name: partial.name ?? 'iface',
    enabled: partial.enabled ?? true,
    status: partial.status ?? 'up',
    tx_queue_used: partial.tx_queue_used ?? null,
    tx_queue_max: partial.tx_queue_max ?? null,
    ...partial,
  };
}

describe('evaluateReticulumRrcTransportReady', () => {
  it('requires at least one online egress interface', () => {
    expect(
      evaluateReticulumRrcTransportReady([row({ type: 'tcp', enabled: true, status: 'down' })], []),
    ).toEqual({ ready: false, reason: 'no_online_egress' });
  });

  it('is ready when TCP is online', () => {
    expect(evaluateReticulumRrcTransportReady([row({ type: 'tcp', status: 'up' })], [])).toEqual({
      ready: true,
    });
  });

  it('does not wait on RNode settling when TCP egress is online', () => {
    expect(
      evaluateReticulumRrcTransportReady(
        [row({ type: 'tcp', status: 'up' }), row({ type: 'rnode', name: 'RNode', status: 'down' })],
        [],
      ),
    ).toEqual({ ready: true });
  });

  it('does not wait on RNode TX queue when TCP egress is online', () => {
    expect(
      evaluateReticulumRrcTransportReady(
        [
          row({ type: 'tcp', status: 'up' }),
          row({
            type: 'rnode',
            name: 'RNode',
            status: 'up',
            tx_queue_used: 9,
            tx_queue_max: 256,
          }),
        ],
        [],
      ),
    ).toEqual({ ready: true });
  });

  it('waits while RF-only egress has an offline local interface', () => {
    expect(
      evaluateReticulumRrcTransportReady(
        [row({ type: 'rnode', name: 'RNode', status: 'down' })],
        [],
      ),
    ).toEqual({ ready: false, reason: 'no_online_egress' });
  });

  it('waits while RF-only RNode TX queue is buffering', () => {
    expect(
      evaluateReticulumRrcTransportReady(
        [
          row({
            type: 'rnode',
            name: 'RNode',
            status: 'up',
            tx_queue_used: 20,
            tx_queue_max: 256,
          }),
        ],
        [],
      ),
    ).toEqual({ ready: false, reason: 'rnode_tx_buffering' });
  });

  it('does not treat small idle RNode TX backlog as buffering', () => {
    expect(
      evaluateReticulumRrcTransportReady(
        [
          row({
            type: 'rnode',
            name: 'RNode',
            status: 'up',
            tx_queue_used: 10,
            tx_queue_max: 256,
          }),
        ],
        [],
      ),
    ).toEqual({ ready: true });
  });
});
