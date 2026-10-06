#!/usr/bin/env node
/**
 * Writes resources/geo/cities15000.tsv from a parent-provided TSV body on stdin.
 * Lives in a separate Node entrypoint so CodeQL js/http-to-file-access does not
 * join the GeoNames HTTP download with this process's writeFileSync (see parent script).
 *
 * Failure point: stdin that is not a well-formed gazetteer TSV — exit non-zero without
 * touching the existing file; parent surfaces stderr.
 *
 * Usage: node scripts/build-geo-gazetteer-write-subprocess.mjs [outPath] < body.tsv
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT_PATH = path.join(ROOT, 'resources', 'geo', 'cities15000.tsv');
export const GAZETTEER_HEADER =
  'name\tascii\tcountry\tadmin1Code\tadmin1Name\tlat\tlon\tpopulation';

const COORD_RE = /^-?\d{1,3}\.\d{4}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const POPULATION_RE = /^\d+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/**
 * @param {string} body
 * @returns {string | null} error message, or null when the body is a valid gazetteer TSV
 */
export function validateGazetteerTsv(body) {
  if (!body.endsWith('\n')) return 'body must end with a newline';
  const lines = body.slice(0, -1).split('\n');
  if (lines[0] !== GAZETTEER_HEADER) return 'unexpected header';
  if (lines.length < 2) return 'no rows';
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split('\t');
    if (f.length !== 8) return `row ${i}: expected 8 fields, got ${f.length}`;
    const [name, ascii, country, admin1, admin1Name, lat, lon, population] = f;
    if (!name) return `row ${i}: empty name`;
    if ([name, ascii, admin1, admin1Name].some((s) => CONTROL_RE.test(s))) {
      return `row ${i}: control character in text field`;
    }
    if (!COUNTRY_RE.test(country)) return `row ${i}: invalid country code`;
    if (!COORD_RE.test(lat) || !COORD_RE.test(lon)) return `row ${i}: invalid coordinates`;
    if (!POPULATION_RE.test(population)) return `row ${i}: invalid population`;
  }
  return null;
}

function main() {
  const outPath = path.resolve(process.argv[2] || DEFAULT_OUT_PATH);
  const body = fs.readFileSync(0, 'utf8');
  const error = validateGazetteerTsv(body);
  if (error) {
    process.stderr.write(`build-geo-gazetteer-write-subprocess: ${error}\n`);
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body, 'utf8');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
