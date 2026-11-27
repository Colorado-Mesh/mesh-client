// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { packetRouter } from '../drivers/PacketRouter';
import type { MeshcomRawPacketEntry } from '../rawPacketLogConstants';
import {
  attachMeshcomRawPacketSideEffects,
  type MeshcomRawPacketSideEffectsDeps,
} from './meshcomRawPacketSideEffects';

const IDENTITY = 'id-meshcom-sniffer';

describe('attachMeshcomRawPacketSideEffects', () => {
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    rafCallbacks = [];
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
    globalThis.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    rafCallbacks.splice(0, rafCallbacks.length);
  });

  function flushAppender(): void {
    for (const cb of rafCallbacks) {
      cb(performance.now());
    }
    rafCallbacks.length = 0;
  }

  it('appends meshcom_rx events to the sniffer buffer', () => {
    const entries: MeshcomRawPacketEntry[] = [];
    const deps: MeshcomRawPacketSideEffectsDeps = {
      setRawPackets: (updater) => {
        const next = typeof updater === 'function' ? updater(entries) : updater;
        entries.splice(0, entries.length, ...next);
      },
    };
    const detach = attachMeshcomRawPacketSideEffects(IDENTITY, deps);
    try {
      packetRouter.dispatch(
        {
          type: 'meshcom_rx',
          payload: {
            ts: 1000,
            snr: 4.5,
            rssi: -90,
            kind: 'msg',
            transport: 'extudp',
            originCallsign: 'CALL1',
            digis: ['DIGI1'],
            hopsAway: 1,
            fromNodeId: 42,
            raw: new Uint8Array([0x7b]),
          },
        },
        IDENTITY,
      );
      flushAppender();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        kind: 'msg',
        transport: 'extudp',
        originCallsign: 'CALL1',
        digis: ['DIGI1'],
        hopsAway: 1,
        fromNodeId: 42,
      });
    } finally {
      detach();
    }
  });
});
