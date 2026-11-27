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
 *
 * Documented coordinate overrides (upstream CSV has known bad rows):
 * - JUH: Chizhou Jiuhuashan Airport → ~30.74, 117.69 (not Mumbai/Borivli)
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
 * Known bad upstream rows — applied after CSV parse so regen preserves corrections.
 * @type {Readonly<Record<string, { name?: string; city?: string; lat: number; lon: number }>>}
 */
const COORDINATE_OVERRIDES = {
  JUH: {
    name: 'Chizhou Jiuhuashan Airport',
    city: 'Chizhou',
    lat: 30.74028,
    lon: 117.68667,
  },
};

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
 * Split CSV text into records, keeping quoted newlines inside a single record.
 * @param {string} csvText
 * @returns {string[]}
 */
export function splitCsvRecords(csvText) {
  const records = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (inQuotes) {
      cur += ch;
      if (ch === '"') {
        if (csvText[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      cur += ch;
      continue;
    }
    if (ch === '\n') {
      if (cur.trim().length > 0) records.push(cur.replace(/\r$/, ''));
      cur = '';
      continue;
    }
    if (ch === '\r') continue;
    cur += ch;
  }
  if (cur.trim().length > 0) records.push(cur.replace(/\r$/, ''));
  return records;
}

/**
 * @param {string} csvText
 * @returns {Array<[string, string, string, number, number]>}
 */
export function parseIataAirportsCsv(csvText) {
  const lines = splitCsvRecords(csvText);
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
    const latRaw = (cols[idx.latitude] ?? '').trim();
    const lonRaw = (cols[idx.longitude] ?? '').trim();
    // Reject missing/blank before Number() so "" cannot become 0.
    if (!latRaw || !lonRaw) continue;
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue;
    const name = (cols[idx.name] ?? '').trim() || code;
    const city = idx.city >= 0 ? (cols[idx.city] ?? '').trim() : '';
    byCode.set(code, [code, name, city, lat, lon]);
  }

  for (const [code, override] of Object.entries(COORDINATE_OVERRIDES)) {
    const prev = byCode.get(code);
    byCode.set(code, [
      code,
      override.name ?? prev?.[1] ?? code,
      override.city ?? prev?.[2] ?? '',
      override.lat,
      override.lon,
    ]);
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
  const body = `${JSON.stringify(payload)}\n`;
  const tmpPath = path.join(
    path.dirname(IATA_AIRPORTS_JSON_PATH),
    `.meshcoreMqttIataAirports.${process.pid}.${Date.now()}.tmp.json`,
  );
  try {
    fs.writeFileSync(tmpPath, body, 'utf8');
    fs.renameSync(tmpPath, IATA_AIRPORTS_JSON_PATH);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // catch-no-log-ok best-effort temp cleanup
    }
    throw err;
  }
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
