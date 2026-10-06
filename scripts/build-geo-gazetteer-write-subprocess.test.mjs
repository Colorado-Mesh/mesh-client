import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { GAZETTEER_HEADER, validateGazetteerTsv } from './build-geo-gazetteer-write-subprocess.mjs';

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'build-geo-gazetteer-write-subprocess.mjs',
);
const VALID = `${GAZETTEER_HEADER}\nBrighton\t\tUS\tCO\tColorado\t39.9853\t-104.8205\t37585\n`;

describe('validateGazetteerTsv', () => {
  it('accepts a well-formed gazetteer', () => {
    expect(validateGazetteerTsv(VALID)).toBeNull();
  });

  it.each([
    ['missing trailing newline', VALID.slice(0, -1)],
    ['wrong header', VALID.replace('name\t', 'nom\t')],
    ['header only', `${GAZETTEER_HEADER}\n`],
    ['wrong field count', `${GAZETTEER_HEADER}\nBrighton\tUS\n`],
    ['bad country', VALID.replace('\tUS\t', '\tusa\t')],
    ['bad coordinate', VALID.replace('39.9853', '39.98')],
    ['bad population', VALID.replace('37585', '-1')],
    ['control char', VALID.replace('Brighton', 'Bri\u0001ghton')],
  ])('rejects %s', (_label, body) => {
    expect(validateGazetteerTsv(body)).not.toBeNull();
  });
});

describe('build-geo-gazetteer-write-subprocess', () => {
  let dir;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('writes a valid body and refuses an invalid one without touching the file', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-gazetteer-'));
    const out = path.join(dir, 'geo', 'cities15000.tsv');

    const ok = spawnSync(process.execPath, [SCRIPT, out], { input: VALID, encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toBe(VALID);

    const bad = spawnSync(process.execPath, [SCRIPT, out], {
      input: 'not a gazetteer\n',
      encoding: 'utf8',
    });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('unexpected header');
    expect(fs.readFileSync(out, 'utf8')).toBe(VALID);
  });
});
