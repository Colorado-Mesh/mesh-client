import { describe, expect, it } from 'vitest';

import {
  clampMeshBeaconInterval,
  clampMeshBeaconMessage,
  clampUtf8Bytes,
  matchMeshBeaconOfferChannel,
  MESH_BEACON_MAX_TARGETS,
  MESH_BEACON_MESSAGE_MAX_BYTES,
  MESH_BEACON_MIN_INTERVAL_SECS,
  meshBeaconTargetsFromConfig,
  meshBeaconTargetsToApply,
  packMeshBeaconFlags,
  unpackMeshBeaconFlags,
  utf8ByteLength,
  validateMeshBeaconTarget,
} from './meshBeaconConfig';

describe('MeshBeacon flags', () => {
  it('unpacks each bit', () => {
    expect(unpackMeshBeaconFlags(0)).toEqual({
      listen: false,
      broadcast: false,
      legacySplit: false,
    });
    expect(unpackMeshBeaconFlags(1)).toMatchObject({ listen: true, broadcast: false });
    expect(unpackMeshBeaconFlags(2)).toMatchObject({ listen: false, broadcast: true });
    expect(unpackMeshBeaconFlags(7)).toEqual({ listen: true, broadcast: true, legacySplit: true });
  });

  it('treats junk as no flags', () => {
    expect(unpackMeshBeaconFlags(undefined)).toEqual(unpackMeshBeaconFlags(0));
    expect(unpackMeshBeaconFlags(-3)).toEqual(unpackMeshBeaconFlags(0));
    expect(unpackMeshBeaconFlags('7')).toEqual(unpackMeshBeaconFlags(0));
  });

  it('packs toggles and preserves unknown bits', () => {
    expect(packMeshBeaconFlags({ listen: true, broadcast: false, legacySplit: true })).toBe(5);
    expect(packMeshBeaconFlags({ listen: false, broadcast: true, legacySplit: false }, 0x107)).toBe(
      0x102,
    );
  });
});

describe('MeshBeacon message budget', () => {
  it('counts UTF-8 bytes', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('📡')).toBe(4);
  });

  it('truncates without splitting a code point', () => {
    expect(clampUtf8Bytes('ab📡', 5)).toBe('ab');
    expect(clampUtf8Bytes('ab📡', 6)).toBe('ab📡');
  });

  it('caps the beacon message at the config limit', () => {
    const long = 'x'.repeat(MESH_BEACON_MESSAGE_MAX_BYTES + 10);
    expect(utf8ByteLength(clampMeshBeaconMessage(long))).toBe(MESH_BEACON_MESSAGE_MAX_BYTES);
    expect(clampMeshBeaconMessage('hello')).toBe('hello');
  });

  it('enforces the minimum broadcast interval', () => {
    expect(clampMeshBeaconInterval(60)).toBe(MESH_BEACON_MIN_INTERVAL_SECS);
    expect(clampMeshBeaconInterval(7200.9)).toBe(7200);
    expect(clampMeshBeaconInterval(Number.NaN)).toBe(MESH_BEACON_MIN_INTERVAL_SECS);
  });
});

describe('MeshBeacon broadcast targets', () => {
  it('reads targets from a device slice, mapping slot 0 to unset', () => {
    expect(
      meshBeaconTargetsFromConfig([
        { region: 3, preset: 5, channelIndex: 1, frequencySlot: 0 },
        { region: 0 },
        null,
      ]),
    ).toEqual([
      { region: 3, preset: 5, channelIndex: 1, frequencySlot: null },
      { region: 0, preset: null, channelIndex: null, frequencySlot: null },
      { region: 0, preset: null, channelIndex: null, frequencySlot: null },
    ]);
    expect(meshBeaconTargetsFromConfig(undefined)).toEqual([]);
  });

  it('caps the list length', () => {
    const many = Array.from({ length: MESH_BEACON_MAX_TARGETS + 3 }, () => ({ region: 1 }));
    expect(meshBeaconTargetsFromConfig(many)).toHaveLength(MESH_BEACON_MAX_TARGETS);
  });

  it('omits unset optionals on the wire', () => {
    expect(
      meshBeaconTargetsToApply([
        { region: 0, preset: null, channelIndex: null, frequencySlot: null },
        { region: 3, preset: 0, channelIndex: 2, frequencySlot: 20 },
        { region: 1, preset: null, channelIndex: null, frequencySlot: 0 },
      ]),
    ).toEqual([
      { region: 0 },
      { region: 3, preset: 0, channelIndex: 2, frequencySlot: 20 },
      { region: 1 },
    ]);
  });

  it('validates channel index and frequency slot', () => {
    const configured = new Set([0, 1]);
    const base = { region: 0, preset: null, channelIndex: null, frequencySlot: null };
    expect(validateMeshBeaconTarget(base, configured)).toBeNull();
    expect(validateMeshBeaconTarget({ ...base, channelIndex: 1 }, configured)).toBeNull();
    expect(validateMeshBeaconTarget({ ...base, channelIndex: 9 }, configured)).toBe(
      'channelIndexRange',
    );
    expect(validateMeshBeaconTarget({ ...base, channelIndex: 4 }, configured)).toBe(
      'channelNotConfigured',
    );
    expect(validateMeshBeaconTarget({ ...base, frequencySlot: 0 }, configured)).toBe(
      'frequencySlot',
    );
  });
});

describe('matchMeshBeaconOfferChannel', () => {
  const channels = [
    { index: 0, name: '', psk: new Uint8Array([1]) },
    { index: 2, name: 'Ops', psk: new Uint8Array([9, 8, 7]) },
  ];

  it('matches by name and PSK', () => {
    expect(
      matchMeshBeaconOfferChannel({ name: 'Ops', psk: new Uint8Array([9, 8, 7]) }, channels),
    ).toBe(2);
    expect(matchMeshBeaconOfferChannel({ name: '', psk: new Uint8Array([1]) }, channels)).toBe(0);
  });

  it('returns null when absent or different', () => {
    expect(matchMeshBeaconOfferChannel(undefined, channels)).toBeNull();
    expect(matchMeshBeaconOfferChannel({ name: '', psk: new Uint8Array() }, channels)).toBeNull();
    expect(
      matchMeshBeaconOfferChannel({ name: 'Ops', psk: new Uint8Array([9, 8]) }, channels),
    ).toBeNull();
  });
});
