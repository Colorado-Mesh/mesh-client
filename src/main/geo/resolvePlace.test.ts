// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseGeoResolvePlaceRequest } from '../../shared/geoPlace';
import { geocodeOpenMeteo, resetOpenMeteoRateLimitForTests } from './openMeteoGeocode';
import { PlaceCache } from './placeCache';
import { placeCacheKey, PlaceResolver } from './resolvePlace';

const TSV = [
  'name\tascii\tcountry\tadmin1Code\tadmin1Name\tlat\tlon\tpopulation',
  'Aurora\t\tUS\tCO\tColorado\t39.7294\t-104.8319\t359407',
  'Aurora\t\tUS\tIL\tIllinois\t41.7606\t-88.3201\t200661',
].join('\n');

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe('PlaceResolver', () => {
  let dir: string;
  let gazetteerPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-geo-resolve-'));
    gazetteerPath = path.join(dir, 'cities.tsv');
    fs.writeFileSync(gazetteerPath, TSV);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves offline from the gazetteer without calling the online geocoder', async () => {
    const geocodeOnline = vi.fn();
    const resolver = new PlaceResolver({
      gazetteerPath,
      cache: PlaceCache.inDirectory(dir),
      geocodeOnline,
    });
    await expect(
      resolver.resolve({ name: 'Aurora', qualifiers: ['CO'], allowOnline: true }),
    ).resolves.toMatchObject({
      lat: 39.7294,
      population: 359407,
      label: 'Aurora, Colorado, US',
      source: 'gazetteer',
    });
    expect(geocodeOnline).not.toHaveBeenCalled();
  });

  it('does not go online unless allowOnline', async () => {
    const geocodeOnline = vi.fn();
    const resolver = new PlaceResolver({
      gazetteerPath,
      cache: PlaceCache.inDirectory(dir),
      geocodeOnline,
    });
    await expect(resolver.resolve({ name: 'Smallville', allowOnline: false })).resolves.toBeNull();
    expect(geocodeOnline).not.toHaveBeenCalled();
  });

  it('falls back online, caches the result, and serves it from cache next time', async () => {
    const geocodeOnline = vi
      .fn()
      .mockResolvedValue({ lat: 1, lon: 2, population: 900, label: 'Smallville, KS, US' });
    const cache = PlaceCache.inDirectory(dir);
    const resolver = new PlaceResolver({ gazetteerPath, cache, geocodeOnline });
    const request = {
      name: 'Smallville',
      qualifiers: ['KS'],
      nearLat: 38,
      nearLon: -97,
      allowOnline: true,
    };
    await expect(resolver.resolve(request)).resolves.toMatchObject({ source: 'online', lat: 1 });
    expect(geocodeOnline).toHaveBeenCalledWith('Smallville', ['KS'], { lat: 38, lon: -97 });
    await expect(resolver.resolve(request)).resolves.toMatchObject({ source: 'cache', lat: 1 });
    expect(geocodeOnline).toHaveBeenCalledTimes(1);
    expect(cache.get(placeCacheKey('smallville', ['ks']))).not.toBeNull();
  });

  it('keeps working when the gazetteer file is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolver = new PlaceResolver({
      gazetteerPath: path.join(dir, 'missing.tsv'),
      cache: PlaceCache.inDirectory(dir),
      geocodeOnline: vi.fn().mockResolvedValue(null),
    });
    await expect(resolver.resolve({ name: 'Aurora', allowOnline: true })).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('geocodeOpenMeteo', () => {
  beforeEach(() => {
    resetOpenMeteoRateLimitForTests();
  });

  it('queries name with the first qualifier and picks the nearest result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            latitude: 50.8,
            longitude: -0.14,
            name: 'Brighton',
            admin1: 'England',
            country_code: 'GB',
            population: 283870,
          },
          {
            latitude: 39.98,
            longitude: -104.82,
            name: 'Brighton',
            admin1: 'Colorado',
            country_code: 'US',
            population: 37585,
          },
        ],
      }),
    );
    const result = await geocodeOpenMeteo(
      'Brighton',
      ['CO'],
      { lat: 39.74, lon: -104.99 },
      fetchImpl,
    );
    expect(result).toEqual({
      lat: 39.98,
      lon: -104.82,
      population: 37585,
      label: 'Brighton, Colorado, US',
    });
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.searchParams.get('name')).toBe('Brighton, CO');
  });

  it('returns null on HTTP errors and when rate-limited', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    let t = 10_000;
    const now = () => t;
    await expect(
      geocodeOpenMeteo('X', [], undefined, fetchImpl as unknown as typeof fetch, now),
    ).resolves.toBeNull();
    t += 100;
    await expect(
      geocodeOpenMeteo('X', [], undefined, fetchImpl as unknown as typeof fetch, now),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('parseGeoResolvePlaceRequest', () => {
  it('accepts a well-formed request and drops out-of-range positions', () => {
    expect(
      parseGeoResolvePlaceRequest({
        name: ' Aurora ',
        qualifiers: ['CO', ' '],
        nearLat: 39.7,
        nearLon: -104.9,
        allowOnline: true,
      }),
    ).toEqual({
      name: 'Aurora',
      qualifiers: ['CO'],
      nearLat: 39.7,
      nearLon: -104.9,
      allowOnline: true,
    });
    expect(
      parseGeoResolvePlaceRequest({ name: 'A', nearLat: 200, nearLon: 0, allowOnline: 'yes' }),
    ).toEqual({ name: 'A', qualifiers: [], allowOnline: false });
  });

  it.each([
    null,
    'x',
    {},
    { name: '' },
    { name: 'x'.repeat(81) },
    { name: 'A', qualifiers: 'CO' },
    { name: 'A', qualifiers: [1] },
  ])('rejects %j', (raw) => {
    expect(parseGeoResolvePlaceRequest(raw)).toBeNull();
  });
});
