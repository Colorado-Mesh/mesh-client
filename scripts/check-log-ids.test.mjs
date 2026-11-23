import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('check:log-ids gate', () => {
  it('package.json exposes check:log-ids', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:log-ids']).toBe('node scripts/check-log-ids.mjs --require-all');
  });

  it('pre-commit runs check:log-ids', () => {
    const hook = fs.readFileSync(path.join(ROOT, '.githooks/pre-commit'), 'utf8');
    expect(hook).toContain('pnpm run check:log-ids');
  });

  it('release.sh runs check:log-ids', () => {
    const release = fs.readFileSync(path.join(ROOT, 'scripts/release.sh'), 'utf8');
    expect(release).toContain('pnpm run check:log-ids');
  });
});
