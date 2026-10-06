#!/usr/bin/env node
/**
 * Regenerates resources/geo/cities15000.tsv from GeoNames (CC-BY 4.0, https://www.geonames.org/).
 *
 * Inputs: cities15000.zip (cities with population >= 15000) and admin1CodesASCII.txt.
 * Output (tab-separated, one header line):
 *   name  ascii  country  admin1Code  admin1Name  lat  lon  population
 * `ascii` is empty when it equals `name`. Coordinates are rounded to 4 decimals.
 *
 * Usage: node scripts/build-geo-gazetteer.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

const GEONAMES_BASE = 'https://download.geonames.org/export/dump';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = path.join(ROOT, 'resources', 'geo', 'cities15000.tsv');

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'mesh-client gazetteer build' } });
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function clean(field) {
  return field.replace(/[\t\r\n]/g, ' ').trim();
}

/** @param {string} admin1Text @param {string} citiesText */
export function buildGazetteerTsv(admin1Text, citiesText) {
  const admin1Names = new Map();
  for (const line of admin1Text.split('\n')) {
    const [code, , asciiName] = line.split('\t');
    if (code && asciiName) admin1Names.set(code, clean(asciiName));
  }

  const rows = [];
  for (const line of citiesText.split('\n')) {
    const f = line.split('\t');
    if (f.length < 15) continue;
    const name = clean(f[1]);
    const ascii = clean(f[2]);
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    const country = f[8];
    const admin1 = f[10];
    const population = Number(f[14]) || 0;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || !country) continue;
    rows.push([
      name,
      ascii === name ? '' : ascii,
      country,
      admin1,
      admin1Names.get(`${country}.${admin1}`) ?? '',
      lat.toFixed(4),
      lon.toFixed(4),
      String(population),
    ]);
  }
  rows.sort((a, b) => Number(b[7]) - Number(a[7]) || a[0].localeCompare(b[0]));
  const header = 'name\tascii\tcountry\tadmin1Code\tadmin1Name\tlat\tlon\tpopulation';
  return [header, ...rows.map((r) => r.join('\t'))].join('\n') + '\n';
}

async function main() {
  console.warn('[build-geo-gazetteer] downloading GeoNames data…');
  const [admin1Buf, citiesZipBuf] = await Promise.all([
    download(`${GEONAMES_BASE}/admin1CodesASCII.txt`),
    download(`${GEONAMES_BASE}/cities15000.zip`),
  ]);
  const zip = await JSZip.loadAsync(citiesZipBuf);
  const entry = zip.file('cities15000.txt');
  if (!entry) throw new Error('cities15000.txt missing from zip');
  const citiesText = await entry.async('string');
  const tsv = buildGazetteerTsv(admin1Buf.toString('utf8'), citiesText);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, tsv);
  console.warn(
    `[build-geo-gazetteer] wrote ${tsv.split('\n').length - 2} places to ${path.relative(ROOT, OUT_PATH)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[build-geo-gazetteer]', err);
    process.exit(1);
  });
}
