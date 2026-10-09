import { describe, expect, it } from 'vitest';

import { parseTakNodeUpdate } from './node-update';

describe('parseTakNodeUpdate', () => {
  it('copies only whitelisted fields', () => {
    const update = parseTakNodeUpdate({
      node_id: 42,
      protocol: 'meshcore',
      latitude: 39.7,
      longitude: -105,
      altitude: 1600,
      battery: 80,
      last_heard: 1_700_000_000,
      short_name: 'AB',
      long_name: 'Alpha Base',
      __proto_pollution: 'x',
      snr: 5,
      hw_model: 'T-BEAM',
    });
    expect(update).toEqual({
      node_id: 42,
      protocol: 'meshcore',
      latitude: 39.7,
      longitude: -105,
      altitude: 1600,
      battery: 80,
      last_heard: 1_700_000_000,
      short_name: 'AB',
      long_name: 'Alpha Base',
      hw_model: 'T-BEAM',
    });
  });

  it('copies advertised role, hops and source', () => {
    const update = parseTakNodeUpdate({
      node_id: 1,
      role: 2,
      hops_away: 3,
      source: 'mqtt',
      infrastructure: true,
    });
    expect(update).toMatchObject({ role: 2, hops_away: 3, source: 'mqtt', infrastructure: true });
  });

  it('copies tracker fix fields within bounds', () => {
    const update = parseTakNodeUpdate({
      node_id: 0xa1b2c3d4,
      uid: 'meshtracker-a1b2c3d4',
      tracker_role: 'k9',
      speed: 1.2,
      course: 90,
      sequence: 1042,
      stale_sec: 30,
    });
    expect(update).toMatchObject({
      uid: 'meshtracker-a1b2c3d4',
      tracker_role: 'k9',
      speed: 1.2,
      course: 90,
      sequence: 1042,
      stale_sec: 30,
    });
  });

  it('drops out-of-range tracker fields and unknown roles', () => {
    const update = parseTakNodeUpdate({
      node_id: 1,
      tracker_role: 'pilot',
      speed: -1,
      course: 360,
      sequence: 1.5,
      stale_sec: 0,
      source: 'lora',
      role: 300,
    });
    expect(update).toEqual({ node_id: 1, protocol: 'meshtastic' });
  });

  it.each(['MESH-1', 'meshtracker-XYZ', 'meshtracker-a1b2c3d4e', 7])(
    'rejects an update with a non-tracker uid %s',
    (uid) => {
      expect(parseTakNodeUpdate({ node_id: 1, uid })).toBeNull();
    },
  );

  it('defaults the protocol to meshtastic', () => {
    expect(parseTakNodeUpdate({ node_id: 1 })?.protocol).toBe('meshtastic');
  });

  it('omits absent optional fields so a partial update keeps cached values', () => {
    const update = parseTakNodeUpdate({ node_id: 1, long_name: 'Only a name' });
    expect(update).toEqual({ node_id: 1, protocol: 'meshtastic', long_name: 'Only a name' });
    expect(Object.keys(update ?? {})).not.toContain('latitude');
  });

  it.each([
    ['not an object', 'node'],
    ['missing node_id', {}],
    ['zero node_id', { node_id: 0 }],
    ['negative node_id', { node_id: -3 }],
    ['fractional node_id', { node_id: 1.5 }],
    ['node_id above uint32', { node_id: 0x1_0000_0000 }],
    ['unknown protocol', { node_id: 1, protocol: 'lora' }],
    ['non-string protocol', { node_id: 1, protocol: 3 }],
    ['latitude out of range', { node_id: 1, latitude: 91, longitude: 0 }],
    ['longitude without latitude', { node_id: 1, longitude: 10 }],
    ['string coordinates', { node_id: 1, latitude: '39', longitude: '-105' }],
  ])('rejects %s', (_label, raw) => {
    expect(parseTakNodeUpdate(raw)).toBeNull();
  });

  it('drops non-finite optional numbers and non-string names', () => {
    const update = parseTakNodeUpdate({
      node_id: 1,
      altitude: Number.NaN,
      battery: 'full',
      last_heard: Number.POSITIVE_INFINITY,
      short_name: 7,
    });
    expect(update).toEqual({ node_id: 1, protocol: 'meshtastic' });
  });

  it('truncates very long names', () => {
    const update = parseTakNodeUpdate({ node_id: 1, long_name: 'x'.repeat(1000) });
    expect(update?.long_name).toHaveLength(256);
  });
});
