import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  meshcoreContactDisplayName,
  sanitizeMeshcoreAdvLatLonForDb,
  sanitizeMeshcoreLastAdvertForDb,
} from './meshcoreContactSanitize';

describe('sanitizeMeshcoreLastAdvertForDb', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for nullish / non-finite / implausible uptime-like values', () => {
    expect(sanitizeMeshcoreLastAdvertForDb(null)).toBeNull();
    expect(sanitizeMeshcoreLastAdvertForDb(undefined)).toBeNull();
    expect(sanitizeMeshcoreLastAdvertForDb(NaN)).toBeNull();
    expect(sanitizeMeshcoreLastAdvertForDb(12345)).toBeNull(); // below plausible epoch floor
  });

  it('clamps unreasonably future last_advert to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));
    const nowSec = Math.floor(Date.now() / 1000);
    const farFuture = nowSec + 10_000;
    expect(sanitizeMeshcoreLastAdvertForDb(farFuture)).toBe(nowSec);
  });

  it('passes through plausible recent timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));
    const nowSec = Math.floor(Date.now() / 1000);
    expect(sanitizeMeshcoreLastAdvertForDb(nowSec - 60)).toBe(nowSec - 60);
  });
});

describe('sanitizeMeshcoreAdvLatLonForDb', () => {
  it('keeps valid pairs and nulls invalid ones', () => {
    expect(sanitizeMeshcoreAdvLatLonForDb(39.7, -104.9)).toEqual({
      adv_lat: 39.7,
      adv_lon: -104.9,
    });
    expect(sanitizeMeshcoreAdvLatLonForDb(999, 0)).toEqual({ adv_lat: null, adv_lon: null });
    expect(sanitizeMeshcoreAdvLatLonForDb(0, null)).toEqual({ adv_lat: null, adv_lon: null });
  });
});

describe('meshcoreContactDisplayName', () => {
  it('prefers nickname, then adv_name, then hex Node- fallback', () => {
    expect(meshcoreContactDisplayName(0xabc, 'Advert', 'Nick')).toBe('Nick');
    expect(meshcoreContactDisplayName(0xabc, 'Advert', '  ')).toBe('Advert');
    expect(meshcoreContactDisplayName(0xabc, null, null)).toBe('Node-ABC');
  });
});
