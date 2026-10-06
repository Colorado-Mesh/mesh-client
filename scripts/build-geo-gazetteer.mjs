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
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

import {
  DEFAULT_OUT_PATH as OUT_PATH,
  GAZETTEER_HEADER,
} from './build-geo-gazetteer-write-subprocess.mjs';

const GEONAMES_BASE = 'https://download.geonames.org/export/dump';
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPTS_DIR, '..');
const WRITE_SUBPROCESS = path.join(SCRIPTS_DIR, 'build-geo-gazetteer-write-subprocess.mjs');

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
  return [GAZETTEER_HEADER, ...rows.map((r) => r.join('\t'))].join('\n') + '\n';
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
  const persist = spawnSync(process.execPath, [WRITE_SUBPROCESS], {
    input: tsv,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (persist.error) throw persist.error;
  if (persist.status !== 0) {
    throw new Error(
      persist.stderr?.trim() || `gazetteer write subprocess exited with status ${persist.status}`,
    );
  }
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
