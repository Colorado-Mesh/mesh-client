#!/usr/bin/env node
/**
 * Generate a compact MeshCore MQTT IATA airport catalog from michaelhart/iata
 * (same source LetsMesh Analyzer uses).
 *
 * Output: src/renderer/lib/meshcoreMqttIataAirports.json
 * Rows: [code, name, city, lat, lon]
 *
 * Usage: node scripts/generate-meshcore-iata-airports.mjs
 * Offline: MESHCORE_IATA_CSV=/path/to/airports.csv node scripts/generate-meshcore-iata-airports.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IATA_AIRPORTS_JSON_PATH = path.join(
  ROOT,
  'src',
  'renderer',
  'lib',
  'meshcoreMqttIataAirports.json',
);

const DEFAULT_CSV_URL = 'https://raw.githubusercontent.com/michaelhart/iata/main/airports.csv';

/**
 * Minimal CSV line split that respects double-quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * @param {string} csvText
 * @returns {Array<[string, string, string, number, number]>}
 */
export function parseIataAirportsCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = {
    code: header.indexOf('code'),
    name: header.indexOf('name'),
    latitude: header.indexOf('latitude'),
    longitude: header.indexOf('longitude'),
    city: header.indexOf('city'),
  };
  if (idx.code < 0 || idx.name < 0 || idx.latitude < 0 || idx.longitude < 0) {
    throw new Error('generate-meshcore-iata-airports: CSV missing required columns');
  }

  /** @type {Map<string, [string, string, string, number, number]>} */
  const byCode = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const code = (cols[idx.code] ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) continue;
    const lat = Number(cols[idx.latitude]);
    const lon = Number(cols[idx.longitude]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue;
    const name = (cols[idx.name] ?? '').trim() || code;
    const city = idx.city >= 0 ? (cols[idx.city] ?? '').trim() : '';
    byCode.set(code, [code, name, city, lat, lon]);
  }
  return [...byCode.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * @param {string} [csvText]
 */
async function generateMeshcoreIataAirportsJson(csvText) {
  let text = csvText;
  if (text == null) {
    const localPath = process.env.MESHCORE_IATA_CSV?.trim();
    if (localPath) {
      text = fs.readFileSync(path.resolve(localPath), 'utf8');
    } else {
      const res = await fetch(DEFAULT_CSV_URL);
      if (!res.ok) {
        throw new Error(
          `generate-meshcore-iata-airports: fetch failed ${res.status} ${res.statusText}`,
        );
      }
      text = await res.text();
    }
  }
  const rows = parseIataAirportsCsv(text);
  if (rows.length < 1000) {
    throw new Error(`generate-meshcore-iata-airports: expected ≥1000 airports, got ${rows.length}`);
  }
  const payload = {
    source: 'https://github.com/michaelhart/iata/blob/main/airports.csv',
    generatedAt: new Date().toISOString().slice(0, 10),
    airports: rows,
  };
  fs.mkdirSync(path.dirname(IATA_AIRPORTS_JSON_PATH), { recursive: true });
  fs.writeFileSync(IATA_AIRPORTS_JSON_PATH, `${JSON.stringify(payload)}\n`, 'utf8');
  return { path: IATA_AIRPORTS_JSON_PATH, count: rows.length };
}

const isMain =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  generateMeshcoreIataAirportsJson()
    .then(({ path: outPath, count }) => {
      console.log(`Wrote ${count} airports → ${path.relative(ROOT, outPath)}`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
