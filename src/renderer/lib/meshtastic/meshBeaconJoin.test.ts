import { describe, expect, it } from 'vitest';

import type { MeshBeaconPayload } from './meshBeaconCodec';
import { findFreeChannelSlot, findJoinedChannel, planMeshBeaconLora } from './meshBeaconJoin';

const psk = (...b: number[]) => new Uint8Array(b);

describe('findJoinedChannel', () => {
  const channels = [
    { index: 0, name: '', role: 1, psk: psk(1) },
    { index: 1, name: 'Ops', role: 2, psk: psk(5, 6) },
    { index: 2, name: 'Old', role: 0, psk: psk(7) },
  ];

  it('matches an active channel with the same name and key', () => {
    expect(findJoinedChannel(channels, { name: 'Ops', psk: psk(5, 6) })).toBe(1);
  });

  it('ignores disabled slots and key mismatches', () => {
    expect(findJoinedChannel(channels, { name: 'Old', psk: psk(7) })).toBeNull();
    expect(findJoinedChannel(channels, { name: 'Ops', psk: psk(5) })).toBeNull();
  });
});

describe('findFreeChannelSlot', () => {
  it('returns the first absent or disabled secondary slot', () => {
    expect(findFreeChannelSlot([{ index: 0, name: '', role: 1, psk: psk() }])).toBe(1);
    expect(
      findFreeChannelSlot([
        { index: 0, name: '', role: 1, psk: psk() },
        { index: 1, name: 'a', role: 2, psk: psk() },
        { index: 2, name: '', role: 0, psk: psk() },
      ]),
    ).toBe(2);
  });

  it('never returns the primary and returns null when full', () => {
    const full = Array.from({ length: 8 }, (_, index) => ({
      index,
      name: `c${index}`,
      role: index === 0 ? 1 : 2,
      psk: psk(),
    }));
    expect(findFreeChannelSlot(full)).toBeNull();
    expect(findFreeChannelSlot([])).toBe(1);
  });
});

function beacon(p: Partial<MeshBeaconPayload>): MeshBeaconPayload {
  return {
    message: '',
    offerChannel: null,
    offerRegion: 0,
    offerPreset: null,
    offerFrequencySlot: null,
    ...p,
  };
}

describe('planMeshBeaconLora', () => {
  const us = { region: 1, modemPreset: 0, usePreset: true, channelNum: 0 };

  it('is none without a radio offer or LoRa config', () => {
    expect(planMeshBeaconLora(beacon({ message: 'x' }), us)).toEqual({ kind: 'none' });
    expect(planMeshBeaconLora(beacon({ offerPreset: 3 }), null)).toEqual({ kind: 'none' });
  });

  it('blocks a different region once the local region is set', () => {
    expect(planMeshBeaconLora(beacon({ offerRegion: 3, offerPreset: 3 }), us)).toEqual({
      kind: 'regionMismatch',
      offerRegion: 3,
      localRegion: 1,
    });
  });

  it('proposes the region only while the local region is unset', () => {
    expect(planMeshBeaconLora(beacon({ offerRegion: 3 }), { ...us, region: 0 })).toEqual({
      kind: 'apply',
      overrides: { region: 3 },
    });
  });

  it('proposes preset and slot changes', () => {
    expect(planMeshBeaconLora(beacon({ offerPreset: 3, offerFrequencySlot: 20 }), us)).toEqual({
      kind: 'apply',
      overrides: { modemPreset: 3, usePreset: true, channelNum: 20 },
    });
  });

  it('resets a pinned slot when the beacon lets the slot be derived', () => {
    expect(planMeshBeaconLora(beacon({ offerPreset: 0 }), { ...us, channelNum: 12 })).toEqual({
      kind: 'apply',
      overrides: { channelNum: 0 },
    });
  });

  it('reports when the radio already matches', () => {
    expect(planMeshBeaconLora(beacon({ offerRegion: 1, offerPreset: 0 }), us)).toEqual({
      kind: 'alreadyMatching',
    });
  });

  it('switches back to preset mode for a custom-modem radio', () => {
    expect(planMeshBeaconLora(beacon({ offerPreset: 0 }), { ...us, usePreset: false })).toEqual({
      kind: 'apply',
      overrides: { modemPreset: 0, usePreset: true },
    });
  });
});
