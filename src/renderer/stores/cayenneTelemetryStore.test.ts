import { afterEach, describe, expect, it } from 'vitest';

import { decodeCayenneLpp } from '../lib/meshtastic/cayenneLpp';
import {
  clearCayenneTelemetry,
  MAX_CAYENNE_NODES,
  MAX_CAYENNE_POINTS_PER_SERIES,
  recordCayennePacket,
  useCayenneTelemetryStore,
} from './cayenneTelemetryStore';

const temp = (tenths: number) =>
  decodeCayenneLpp(new Uint8Array([0x01, 0x67, (tenths >> 8) & 0xff, tenths & 0xff]));

describe('cayenneTelemetryStore', () => {
  afterEach(() => {
    useCayenneTelemetryStore.setState({ byIdentity: {} });
  });

  it('appends points per series and node', () => {
    recordCayennePacket('id', { from: 7, timestamp: 1, decoded: temp(100) });
    recordCayennePacket('id', { from: 7, timestamp: 2, decoded: temp(110) });
    const series = useCayenneTelemetryStore
      .getState()
      .byIdentity.id?.get(7)
      ?.series.get('temperature#1');
    expect(series?.points).toEqual([
      { timestamp: 1, value: 10 },
      { timestamp: 2, value: 11 },
    ]);
  });

  it('ignores packets with no readings', () => {
    recordCayennePacket('id', {
      from: 7,
      timestamp: 1,
      decoded: { readings: [], truncated: true },
    });
    expect(useCayenneTelemetryStore.getState().byIdentity.id).toBeUndefined();
  });

  it('bounds points per series and nodes per identity', () => {
    for (let i = 0; i < MAX_CAYENNE_POINTS_PER_SERIES + 20; i++) {
      recordCayennePacket('id', { from: 1, timestamp: i, decoded: temp(i % 500) });
    }
    expect(
      useCayenneTelemetryStore.getState().byIdentity.id?.get(1)?.series.get('temperature#1')
        ?.points,
    ).toHaveLength(MAX_CAYENNE_POINTS_PER_SERIES);
    for (let n = 100; n < 100 + MAX_CAYENNE_NODES + 5; n++) {
      recordCayennePacket('id', { from: n, timestamp: n, decoded: temp(1) });
    }
    expect(useCayenneTelemetryStore.getState().byIdentity.id?.size).toBe(MAX_CAYENNE_NODES);
  });

  it('keeps identities separate and clears one', () => {
    recordCayennePacket('a', { from: 1, timestamp: 1, decoded: temp(1) });
    recordCayennePacket('b', { from: 1, timestamp: 1, decoded: temp(1) });
    clearCayenneTelemetry('a');
    expect(useCayenneTelemetryStore.getState().byIdentity.a).toBeUndefined();
    expect(useCayenneTelemetryStore.getState().byIdentity.b).toBeDefined();
  });
});
