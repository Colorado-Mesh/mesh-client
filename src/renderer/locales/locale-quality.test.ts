import { execFileSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('locale translation files', () => {
  it('passes check:i18n (keys, no CAT/XML artifacts, placeholder parity vs English)', () => {
    const projectRoot = path.resolve(import.meta.dirname ?? __dirname, '..', '..', '..');
    execFileSync('node', [path.join(projectRoot, 'scripts', 'check-i18n.mjs')], {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: projectRoot,
    });
    expect(true).toBe(true);
  });
});
