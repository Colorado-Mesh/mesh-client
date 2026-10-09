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
