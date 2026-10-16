import { describe, expect, it } from 'vitest';

import type { MeshNode } from '../../renderer/lib/types';
import type { TakStyleSettings, TakUnitFilter } from '../../shared/tak-types';
import { TAK_PERSON_STYLE, TAK_RELAY_STYLE } from './advertised-style';
import { resolveTakStyle } from './unit-filters';

const EMS = { cotType: 'a-f-G-U-S-M', group: 'White', role: 'Medic' };
const K9 = { cotType: 'a-f-G-U-C', role: 'K9' };

function node(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 7,
    long_name: 'Medic 12',
    short_name: '',
    hw_model: 'Chat',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: 39,
    longitude: -105,
    ...overrides,
  };
}

function filter(overrides: Partial<TakUnitFilter> = {}): TakUnitFilter {
  return {
    enabled: true,
    op: 'startsWith',
    patterns: ['medic'],
    stripMatch: false,
    style: EMS,
    ...overrides,
  };
}

function settings(filters: TakUnitFilter[], sendUnmatched = true): TakStyleSettings {
  return { filters, sendUnmatched };
}

describe('resolveTakStyle', () => {
  it('uses the advertised style when no filter matches', () => {
    const r = resolveTakStyle(settings([filter({ patterns: ['k9'] })]), node(), 'meshcore');
    expect(r).toEqual({ style: TAK_PERSON_STYLE, callsign: 'Medic 12', matched: false });
    const relay = resolveTakStyle(settings([]), node({ hw_model: 'Repeater' }), 'meshcore');
    expect(relay?.style).toBe(TAK_RELAY_STYLE);
  });

  it('matches case-insensitively and lets the first enabled filter win', () => {
    const r = resolveTakStyle(
      settings([
        filter({ enabled: false, patterns: ['MEDIC'], style: K9 }),
        filter({ patterns: ['MEDIC'] }),
        filter({ op: 'contains', patterns: ['12'], style: K9 }),
      ]),
      node(),
      'meshcore',
    );
    expect(r).toEqual({ style: EMS, callsign: 'Medic 12', matched: true });
  });

  it.each([
    ['equals', 'medic 12', true],
    ['equals', 'medic', false],
    ['endsWith', ' 12', true],
    ['contains', 'dic', true],
  ] as const)('%s %s matches=%s', (op, pattern, expected) => {
    const r = resolveTakStyle(settings([filter({ op, patterns: [pattern] })]), node(), 'meshcore');
    expect(r?.matched).toBe(expected);
  });

  it('strips a matched prefix or suffix and the separator from the callsign', () => {
    const prefix = resolveTakStyle(
      settings([filter({ patterns: ['EMS-'], stripMatch: true })]),
      node({ long_name: 'EMS-Unit 3' }),
      'meshcore',
    );
    expect(prefix?.callsign).toBe('Unit 3');
    const suffix = resolveTakStyle(
      settings([filter({ op: 'endsWith', patterns: ['k9'], stripMatch: true, style: K9 })]),
      node({ long_name: 'Rex K9' }),
      'meshcore',
    );
    expect(suffix?.callsign).toBe('Rex');
  });

  it('keeps the callsign when stripping would leave it empty', () => {
    const r = resolveTakStyle(
      settings([filter({ op: 'equals', patterns: ['medic 12'], stripMatch: true })]),
      node(),
      'meshcore',
    );
    expect(r?.callsign).toBe('Medic 12');
  });

  it('falls back to the long name for a Meshtastic node and does not strip it', () => {
    const r = resolveTakStyle(
      settings([filter({ patterns: ['medic'], stripMatch: true })]),
      node({ short_name: 'M12' }),
      'meshtastic',
    );
    expect(r).toEqual({ style: EMS, callsign: 'M12', matched: true });
  });

  it('drops unmatched nodes when sendUnmatched is off', () => {
    const s = settings([filter({ patterns: ['k9'] })], false);
    expect(resolveTakStyle(s, node(), 'meshcore')).toBeNull();
    expect(resolveTakStyle(s, node({ long_name: 'K9 Rex' }), 'meshcore')?.matched).toBe(true);
  });
});

describe('resolveTakStyle relay icon', () => {
  const ICON = 'geoops/WildFire/Repeater.png';
  const withIcon = (filters: TakUnitFilter[] = []): TakStyleSettings => ({
    ...settings(filters),
    relayIconsetPath: ICON,
  });

  it('adds the repeater icon to repeaters of any protocol, but not to room servers', () => {
    const repeater = node({ long_name: 'Ridge', hw_model: 'Repeater' });
    expect(resolveTakStyle(withIcon(), repeater, 'meshcore')?.style).toEqual({
      ...TAK_RELAY_STYLE,
      iconsetPath: ICON,
    });
    const room = node({ long_name: 'Lobby', hw_model: 'Room' });
    expect(resolveTakStyle(withIcon(), room, 'meshcore')?.style).toBe(TAK_RELAY_STYLE);
    const router = node({ long_name: 'Tower', role: 2 });
    expect(resolveTakStyle(withIcon(), router, 'meshtastic')?.style.iconsetPath).toBe(ICON);
  });

  it('leaves the shared relay style untouched', () => {
    resolveTakStyle(withIcon(), node({ hw_model: 'Repeater' }), 'meshcore');
    expect(TAK_RELAY_STYLE).not.toHaveProperty('iconsetPath');
  });

  it('does not add it to companions or when unset', () => {
    const companion = node({ long_name: 'Ridge', hw_model: 'Chat' });
    expect(resolveTakStyle(withIcon(), companion, 'meshcore')?.style).toBe(TAK_PERSON_STYLE);
    const matchedCompanion = node({ long_name: 'Medic 12', hw_model: 'Chat' });
    expect(resolveTakStyle(withIcon([filter()]), matchedCompanion, 'meshcore')?.style).toBe(EMS);
    const repeater = node({ long_name: 'Ridge', hw_model: 'Repeater' });
    expect(resolveTakStyle(settings([]), repeater, 'meshcore')?.style).toBe(TAK_RELAY_STYLE);
  });

  it('gives room servers their own icon when one is set, and only them', () => {
    const ROOM_ICON = 'geoops/WildFire/Ranger Station.png';
    const s: TakStyleSettings = { ...withIcon(), roomIconsetPath: ROOM_ICON };
    const room = node({ long_name: 'Lobby', hw_model: 'Room' });
    expect(resolveTakStyle(s, room, 'meshcore')?.style.iconsetPath).toBe(ROOM_ICON);
    const repeater = node({ long_name: 'Ridge', hw_model: 'Repeater' });
    expect(resolveTakStyle(s, repeater, 'meshcore')?.style.iconsetPath).toBe(ICON);
  });

  it('gives room servers an icon of their own even with no repeater icon', () => {
    const ROOM_ICON = 'geoops/WildFire/Ranger Station.png';
    const s: TakStyleSettings = { ...settings([]), roomIconsetPath: ROOM_ICON };
    const room = node({ long_name: 'Lobby', hw_model: 'Room' });
    expect(resolveTakStyle(s, room, 'meshcore')?.style.iconsetPath).toBe(ROOM_ICON);
    const repeater = node({ long_name: 'Ridge', hw_model: 'Repeater' });
    expect(resolveTakStyle(s, repeater, 'meshcore')?.style).toBe(TAK_RELAY_STYLE);
  });
});

describe('resolveTakStyle icons on filtered nodes', () => {
  const REPEATER_ICON = 'geoops/WildFire/Repeater.png';
  const ROOM_ICON = 'geoops/WildFire/Repeater Mobile Relay.png';
  const RTO = { cotType: 'a-f-G-I', group: 'Purple', role: 'RTO' };
  const icons = (filters: TakUnitFilter[]): TakStyleSettings => ({
    ...settings(filters),
    relayIconsetPath: REPEATER_ICON,
    roomIconsetPath: ROOM_ICON,
  });

  it('keeps the room server icon when a filter sets its team and role', () => {
    const s = icons([filter({ nodeKind: 'room', patterns: [], style: RTO })]);
    const room = node({ long_name: 'Lobby', hw_model: 'Room' });
    expect(resolveTakStyle(s, room, 'meshcore')).toEqual({
      style: { ...RTO, iconsetPath: ROOM_ICON },
      callsign: 'Lobby',
      matched: true,
    });
    expect(RTO).not.toHaveProperty('iconsetPath');
  });

  it('keeps the repeater icon when a name filter restyles a repeater', () => {
    const repeater = node({ long_name: 'Medic relay', hw_model: 'Repeater' });
    expect(resolveTakStyle(icons([filter()]), repeater, 'meshcore')?.style).toEqual({
      ...EMS,
      iconsetPath: REPEATER_ICON,
    });
  });

  it('adds no icon to companions or sensors a filter restyles', () => {
    const s = icons([filter()]);
    for (const hw_model of ['Chat', 'Sensor']) {
      expect(resolveTakStyle(s, node({ hw_model }), 'meshcore')?.style).toBe(EMS);
    }
  });
});

describe('resolveTakStyle node kind and protocol conditions', () => {
  const ORANGE = { cotType: 'a-f-G-U-C', group: 'Orange', role: 'Team Member' };
  const BROWN = { cotType: 'a-f-G-E-S', group: 'Brown' };
  const RTO = { cotType: 'a-f-G-U-C', group: 'Purple', role: 'RTO' };
  const byKind = (overrides: Partial<TakUnitFilter>): TakUnitFilter =>
    filter({ patterns: [], ...overrides });

  const filters = [
    byKind({ nodeKind: 'companion', protocol: 'meshcore', style: ORANGE }),
    byKind({ nodeKind: 'sensor', style: BROWN }),
    byKind({ nodeKind: 'room', style: RTO }),
  ];

  it('restyles every node of a kind without a name pattern', () => {
    const companion = node({ long_name: 'Ridge', hw_model: 'Chat' });
    expect(resolveTakStyle(settings(filters), companion, 'meshcore')).toMatchObject({
      style: ORANGE,
      callsign: 'Ridge',
      matched: true,
    });
    const sensor = node({ long_name: 'Creek gauge', hw_model: 'Sensor' });
    expect(resolveTakStyle(settings(filters), sensor, 'meshcore')?.style).toBe(BROWN);
    const room = node({ long_name: 'Lobby', hw_model: 'Room' });
    expect(resolveTakStyle(settings(filters), room, 'meshcore')?.style).toBe(RTO);
  });

  it('tells repeaters from room servers and leaves other kinds to their advertised style', () => {
    const repeater = node({ long_name: 'Peak', hw_model: 'Repeater' });
    expect(resolveTakStyle(settings(filters), repeater, 'meshcore')).toMatchObject({
      style: TAK_RELAY_STYLE,
      matched: false,
    });
  });

  it('applies the protocol condition', () => {
    const client = node({ long_name: 'Ridge', role: 0 });
    expect(resolveTakStyle(settings(filters), client, 'meshtastic')?.style).toBe(TAK_PERSON_STYLE);
    const sensor = node({ long_name: 'Weather', role: 6 });
    expect(resolveTakStyle(settings(filters), sensor, 'meshtastic')?.style).toBe(BROWN);
    const onlyMeshtastic = [byKind({ protocol: 'meshtastic', style: ORANGE })];
    expect(resolveTakStyle(settings(onlyMeshtastic), client, 'meshtastic')?.style).toBe(ORANGE);
    expect(resolveTakStyle(settings(onlyMeshtastic), client, 'meshcore')?.style).toBe(
      TAK_PERSON_STYLE,
    );
  });

  it('requires the name pattern as well when one is set', () => {
    const named = [filter({ nodeKind: 'repeater', patterns: ['medic'], style: EMS })];
    const repeater = node({ long_name: 'Medic relay', hw_model: 'Repeater' });
    expect(resolveTakStyle(settings(named), repeater, 'meshcore')?.style).toBe(EMS);
    const otherRepeater = node({ long_name: 'Peak', hw_model: 'Repeater' });
    expect(resolveTakStyle(settings(named), otherRepeater, 'meshcore')?.matched).toBe(false);
    const companion = node({ long_name: 'Medic 12', hw_model: 'Chat' });
    expect(resolveTakStyle(settings(named), companion, 'meshcore')?.matched).toBe(false);
  });

  it('lets the first matching filter win and skips disabled ones', () => {
    const ordered = [
      byKind({ nodeKind: 'companion', enabled: false, style: BROWN }),
      filter({ patterns: ['medic'], style: EMS }),
      byKind({ nodeKind: 'companion', style: ORANGE }),
    ];
    const medic = node({ long_name: 'Medic 12', hw_model: 'Chat' });
    expect(resolveTakStyle(settings(ordered), medic, 'meshcore')?.style).toBe(EMS);
    const other = node({ long_name: 'Ridge', hw_model: 'Chat' });
    expect(resolveTakStyle(settings(ordered), other, 'meshcore')?.style).toBe(ORANGE);
  });

  it('matches nothing with a filter that sets no condition', () => {
    const empty = [byKind({ style: ORANGE })];
    const companion = node({ long_name: 'Ridge', hw_model: 'Chat' });
    expect(resolveTakStyle(settings(empty), companion, 'meshcore')?.matched).toBe(false);
  });

  it('matches trackers by kind', () => {
    const trackers = [byKind({ nodeKind: 'tracker', style: ORANGE })];
    const tracker = node({ long_name: 'Rex', hw_model: 'Chat' });
    expect(
      resolveTakStyle(settings(trackers), { ...tracker, tracker_role: 'k9' }, 'meshcore')?.style,
    ).toBe(ORANGE);
    expect(resolveTakStyle(settings(trackers), tracker, 'meshcore')?.matched).toBe(false);
  });
});
