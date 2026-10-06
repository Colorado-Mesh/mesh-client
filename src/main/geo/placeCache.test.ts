// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLACE_CACHE_FILENAME, PLACE_CACHE_MAX_ENTRIES, PlaceCache } from './placeCache';

describe('PlaceCache', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-geo-cache-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips entries through the JSON file', () => {
    const a = PlaceCache.inDirectory(dir);
    a.set('aurora|co', { lat: 39.7, lon: -104.8, population: 359407, label: 'Aurora, CO' });
    const b = PlaceCache.inDirectory(dir);
    expect(b.get('aurora|co')).toEqual({
      lat: 39.7,
      lon: -104.8,
      population: 359407,
      label: 'Aurora, CO',
      source: 'cache',
    });
    expect(b.get('missing')).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([PLACE_CACHE_FILENAME]);
  });

  it('treats a corrupt file as empty and logs', () => {
    fs.writeFileSync(path.join(dir, PLACE_CACHE_FILENAME), '{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = PlaceCache.inDirectory(dir);
    expect(cache.get('x')).toBeNull();
    expect(warn).toHaveBeenCalled();
    cache.set('x', { lat: 1, lon: 2, label: 'X' });
    expect(PlaceCache.inDirectory(dir).get('x')?.lat).toBe(1);
    warn.mockRestore();
  });

  it('ignores malformed entries', () => {
    fs.writeFileSync(
      path.join(dir, PLACE_CACHE_FILENAME),
      JSON.stringify({ ok: { lat: 1, lon: 2, label: 'ok', savedAt: 1 }, bad: { lat: 'x' } }),
    );
    const cache = PlaceCache.inDirectory(dir);
    expect(cache.get('ok')).not.toBeNull();
    expect(cache.get('bad')).toBeNull();
  });

  it('evicts the oldest entries beyond the cap', () => {
    const cache = PlaceCache.inDirectory(dir);
    for (let i = 0; i <= PLACE_CACHE_MAX_ENTRIES; i++) {
      cache.set(`k${i}`, { lat: 0, lon: 0, label: String(i) });
    }
    const reloaded = PlaceCache.inDirectory(dir);
    expect(reloaded.get('k0')).toBeNull();
    expect(reloaded.get(`k${PLACE_CACHE_MAX_ENTRIES}`)).not.toBeNull();
  });
});
