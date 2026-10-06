// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  gazetteerLabel,
  normalizePlaceToken,
  parseGazetteerTsv,
  pickBestCandidate,
  qualifierMatches,
  searchGazetteer,
} from './gazetteer';

const TSV = [
  'name\tascii\tcountry\tadmin1Code\tadmin1Name\tlat\tlon\tpopulation',
  'Aurora\t\tUS\tCO\tColorado\t39.7294\t-104.8319\t359407',
  'Aurora\t\tUS\tIL\tIllinois\t41.7606\t-88.3201\t200661',
  'Aurora\t\tCA\t08\tOntario\t44.0001\t-79.4663\t55445',
  'Brighton\t\tGB\tENG\tEngland\t50.8284\t-0.1395\t283870',
  'Brighton\t\tUS\tCO\tColorado\t39.9853\t-104.8205\t37585',
  'Zürich\tZurich\tCH\t25\tZurich\t47.3667\t8.5500\t341730',
  'Vancouver\t\tCA\t02\tBritish Columbia\t49.2497\t-123.1193\t600000',
  'broken row',
].join('\n');

const DENVER = { lat: 39.7392, lon: -104.9903 };

describe('gazetteer', () => {
  const index = parseGazetteerTsv(TSV);

  it('parses rows and skips malformed ones', () => {
    expect(index.size).toBe(7);
  });

  it('indexes ASCII names and strips diacritics', () => {
    expect(normalizePlaceToken('  Zürich ')).toBe('zurich');
    expect(searchGazetteer(index, 'Zurich', [])?.country).toBe('CH');
  });

  it('matches qualifiers by state code, so Aurora, CO is never Aurora, IL', () => {
    expect(searchGazetteer(index, 'Aurora', ['CO'])?.admin1Code).toBe('CO');
    expect(searchGazetteer(index, 'Aurora', ['IL'])?.admin1Code).toBe('IL');
    expect(searchGazetteer(index, 'aurora', ['Illinois'])?.admin1Code).toBe('IL');
  });

  it('matches qualifiers by country code and country name', () => {
    const place = index.byName.get('vancouver')![0];
    expect(qualifierMatches(place, 'CA')).toBe(true);
    expect(qualifierMatches(place, 'Canada')).toBe(true);
    expect(qualifierMatches(place, 'British Columbia')).toBe(true);
    expect(searchGazetteer(index, 'Vancouver', ['BC', 'Canada'])?.country).toBe('CA');
    expect(searchGazetteer(index, 'Brighton', ['UK'])?.country).toBe('GB');
  });

  it('returns null when qualifiers match nothing', () => {
    expect(searchGazetteer(index, 'Aurora', ['TX'])).toBeNull();
    expect(searchGazetteer(index, 'Nowhere', [])).toBeNull();
  });

  it('picks the nearest candidate when a position is given', () => {
    expect(searchGazetteer(index, 'Brighton', [], DENVER)?.country).toBe('US');
    expect(searchGazetteer(index, 'Brighton', [], { lat: 51.5, lon: -0.12 })?.country).toBe('GB');
  });

  it('picks the most populous candidate without a position', () => {
    expect(searchGazetteer(index, 'Brighton', [])?.country).toBe('GB');
    expect(pickBestCandidate([])).toBeNull();
  });

  it('builds a readable label', () => {
    expect(gazetteerLabel(searchGazetteer(index, 'Aurora', ['CO'])!)).toBe('Aurora, Colorado, US');
  });

  it('resolves both user example towns from the bundled asset', () => {
    const asset = path.join(__dirname, '..', '..', '..', 'resources', 'geo', 'cities15000.tsv');
    const real = parseGazetteerTsv(fs.readFileSync(asset, 'utf8'));
    expect(real.size).toBeGreaterThan(20000);
    const aurora = searchGazetteer(real, 'Aurora', ['CO'], DENVER);
    const brighton = searchGazetteer(real, 'Brighton', ['CO'], DENVER);
    expect(aurora).toMatchObject({ country: 'US', admin1Code: 'CO' });
    expect(brighton).toMatchObject({ country: 'US', admin1Code: 'CO' });
  });
});
