import { execFileSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('locale translation files', () => {
  it('passes check:i18n (keys, no CAT/XML artifacts, placeholder parity vs English)', () => {
    const projectRoot = path.resolve(import.meta.dirname ?? __dirname, '..', '..', '..');
    const output = execFileSync('node', [path.join(projectRoot, 'scripts', 'check-i18n.mjs')], {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: projectRoot,
    });
    expect(output).toContain('check:i18n passed');
    // Runs the whole i18n checker in a child process (about 5 s alone), so the 5 s default
    // fails under the load of a full test run.
  }, 30_000);
});
