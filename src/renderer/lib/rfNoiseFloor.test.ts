import { describe, expect, it } from 'vitest';

import {
  collectEstimatedNoiseFloors,
  ESTIMATED_NOISE_FLOOR_BUCKETS,
  estimateNoiseFloorDbm,
  isPlausibleNoiseFloorDbm,
  medianOf,
  readLocalNoiseFloor,
} from './rfNoiseFloor';
import type { MeshNode } from './types';

function node(partial: Partial<MeshNode> & Pick<MeshNode, 'node_id'>): MeshNode {
  return {
    long_name: '',
    short_name: '',
    hw_model: '',
    battery: 0,
    snr: 0,
    rssi: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    ...partial,
  };
}

describe('rfNoiseFloor', () => {
  it('isPlausibleNoiseFloorDbm accepts band edges and rejects sentinels', () => {
    expect(isPlausibleNoiseFloorDbm(-140)).toBe(true);
    expect(isPlausibleNoiseFloorDbm(-110)).toBe(true);
    expect(isPlausibleNoiseFloorDbm(-20)).toBe(true);
    expect(isPlausibleNoiseFloorDbm(0)).toBe(false);
    expect(isPlausibleNoiseFloorDbm(-141)).toBe(false);
    expect(isPlausibleNoiseFloorDbm(-19)).toBe(false);
    expect(isPlausibleNoiseFloorDbm(NaN)).toBe(false);
    expect(isPlausibleNoiseFloorDbm(Infinity)).toBe(false);
    expect(isPlausibleNoiseFloorDbm(null)).toBe(false);
    expect(isPlausibleNoiseFloorDbm('-110')).toBe(false);
    expect(isPlausibleNoiseFloorDbm(undefined)).toBe(false);
  });

  it('readLocalNoiseFloor returns null for undefined / sentinel MeshCore stats', () => {
    expect(readLocalNoiseFloor(undefined)).toBeNull();
    expect(
      readLocalNoiseFloor(
        node({
          node_id: 1,
          meshcore_local_stats: {
            batteryMilliVolts: 4000,
            uptimeSecs: 1,
            queueLen: 0,
            noiseFloor: 0,
            lastRssi: 0,
            lastSnr: 0,
            txAirSecs: 0,
            rxAirSecs: 0,
            recv: 0,
            sent: 0,
            nSentFlood: 0,
            nSentDirect: 0,
            nRecvFlood: 0,
            nRecvDirect: 0,
            fetchedAt: 42,
          },
        }),
      ),
    ).toBeNull();
  });

  it('readLocalNoiseFloor prefers MeshNode.noise_floor over meshcore_local_stats', () => {
    expect(
      readLocalNoiseFloor(node({ node_id: 1, noise_floor: -108, noise_floor_observed_at: 9_001 })),
    ).toEqual({
      value: -108,
      observedAt: 9_001,
    });
    expect(
      readLocalNoiseFloor(
        node({
          node_id: 1,
          meshcore_local_stats: {
            batteryMilliVolts: 4000,
            uptimeSecs: 1,
            queueLen: 0,
            noiseFloor: -112,
            lastRssi: 0,
            lastSnr: 0,
            txAirSecs: 0,
            rxAirSecs: 0,
            recv: 0,
            sent: 0,
            nSentFlood: 0,
            nSentDirect: 0,
            nRecvFlood: 0,
            nRecvDirect: 0,
            fetchedAt: 42,
          },
        }),
      ),
    ).toEqual({ value: -112, observedAt: 42 });
    expect(
      readLocalNoiseFloor(
        node({
          node_id: 1,
          noise_floor: -108,
          meshcore_local_stats: {
            batteryMilliVolts: 4000,
            uptimeSecs: 1,
            queueLen: 0,
            noiseFloor: -112,
            lastRssi: 0,
            lastSnr: 0,
            txAirSecs: 0,
            rxAirSecs: 0,
            recv: 0,
            sent: 0,
            nSentFlood: 0,
            nSentDirect: 0,
            nRecvFlood: 0,
            nRecvDirect: 0,
            fetchedAt: 42,
          },
        }),
      ),
    ).toEqual({ value: -108 }); // no observedAt when Meshtastic field omits it
  });

  it('estimateNoiseFloorDbm rejects zero / missing inputs', () => {
    expect(estimateNoiseFloorDbm(-95, 6)).toBe(-101);
    expect(estimateNoiseFloorDbm(-95, 0)).toBeNull();
    expect(estimateNoiseFloorDbm(0, 6)).toBeNull();
    expect(estimateNoiseFloorDbm(undefined, 6)).toBeNull();
  });

  it('collectEstimatedNoiseFloors skips nodes missing rssi/snr', () => {
    expect(
      collectEstimatedNoiseFloors([
        node({ node_id: 1, rssi: -100, snr: 5 }),
        node({ node_id: 2, rssi: 0, snr: 5 }),
        node({ node_id: 3, rssi: -98, snr: 0 }),
      ]),
    ).toEqual([-105]);
  });

  it('medianOf handles empty, odd, even lengths without mutating input', () => {
    expect(medianOf([])).toBeNull();
    const odd = [-100, -90, -110];
    expect(medianOf(odd)).toBe(-100);
    expect(odd).toEqual([-100, -90, -110]);
    expect(medianOf([-100, -90, -110, -80])).toBe(-95);
  });

  it('ESTIMATED_NOISE_FLOOR_BUCKETS cover probe values exactly once each', () => {
    const probes = [-130, -120, -110, -100, -90, -80];
    for (const v of probes) {
      const matches = ESTIMATED_NOISE_FLOOR_BUCKETS.filter((b) => b.test(v));
      expect(matches).toHaveLength(1);
    }
  });
});
