import { describe, expect, it } from 'vitest';

import type { TakFilterSubject, TakUnitFilter } from './tak-types';
import { matchTakUnitFilter } from './takUnitFilterMatch';

function subject(overrides: Partial<TakFilterSubject> = {}): TakFilterSubject {
  return { kind: 'companion', protocol: 'meshcore', ...overrides };
}

function filter(overrides: Partial<TakUnitFilter> = {}): TakUnitFilter {
  return {
    enabled: true,
    op: 'equals',
    patterns: [],
    stripMatch: false,
    style: { cotType: '' },
    ...overrides,
  };
}

describe('matchTakUnitFilter', () => {
  it('matches by callsign pattern (case-insensitive)', () => {
    const f = filter({ patterns: ['N0CALL'] });
    const m = matchTakUnitFilter([f], 'n0call', 'Home Node', subject());
    expect(m?.callsign).toBe('n0call');
    expect(m?.index).toBe(0);
  });

  it('falls back to long name when callsign does not match', () => {
    const f = filter({ patterns: ['Home'], op: 'contains' });
    const m = matchTakUnitFilter([f], 'N0CALL', 'Home Node', subject());
    expect(m?.callsign).toBe('N0CALL');
  });

  it('strips matched prefix when stripMatch is set', () => {
    const f = filter({ op: 'startsWith', patterns: ['N0'], stripMatch: true });
    const m = matchTakUnitFilter([f], 'N0CALL', '', subject());
    expect(m?.callsign).toBe('CALL');
  });

  it('returns null for disabled filters', () => {
    const f = filter({ enabled: false, patterns: ['N0CALL'] });
    expect(matchTakUnitFilter([f], 'N0CALL', '', subject())).toBeNull();
  });

  it('respects node kind and protocol conditions', () => {
    const f = filter({ patterns: ['N0CALL'], nodeKind: 'companion', protocol: 'meshcore' });
    expect(matchTakUnitFilter([f], 'N0CALL', '', subject({ protocol: 'meshtastic' }))).toBeNull();
    expect(
      matchTakUnitFilter([f], 'N0CALL', '', subject({ protocol: 'meshcore', kind: 'companion' })),
    ).not.toBeNull();
  });

  it('matches on kind/protocol alone when no patterns, but matches nothing when no conditions', () => {
    const kindOnly = filter({ patterns: [], nodeKind: 'companion' });
    expect(
      matchTakUnitFilter([kindOnly], 'N0CALL', '', subject({ kind: 'companion' })),
    ).not.toBeNull();
    expect(matchTakUnitFilter([kindOnly], 'N0CALL', '', subject({ kind: 'tracker' }))).toBeNull();

    const empty = filter({ patterns: [] });
    expect(matchTakUnitFilter([empty], 'N0CALL', '', subject())).toBeNull();
  });

  it('ignores empty patterns and returns the first matching filter', () => {
    const f1 = filter({ patterns: [''] });
    const f2 = filter({ patterns: ['N0CALL'] });
    const m = matchTakUnitFilter([f1, f2], 'N0CALL', '', subject());
    expect(m?.index).toBe(1);
  });

  it('returns null when nothing matches', () => {
    const f = filter({ patterns: ['ZZZ'] });
    expect(matchTakUnitFilter([f], 'N0CALL', '', subject())).toBeNull();
  });
});
