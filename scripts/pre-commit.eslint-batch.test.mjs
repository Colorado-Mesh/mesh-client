// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRE_COMMIT = path.join(ROOT, '.githooks/pre-commit');

/**
 * @param {string} line
 * @returns {boolean}
 */
function isEslintInvocation(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('pnpm exec eslint') || trimmed.startsWith('pnpm  exec eslint');
}

/** Options that consume the following argument as their value. */
const OPTIONS_TAKING_VALUE = new Set(['--max-warnings']);

/**
 * Safe form: `pnpm exec eslint <options> -- "$@"` (+ optional `|| exit 1`), where every
 * argument before `--` is an option so staged paths reach eslint literally.
 * @param {string} line
 * @returns {boolean}
 */
function isSafeEslintInvocation(line) {
  const PREFIX = 'pnpm exec eslint ';
  const SUFFIX = ' -- "$@"';
  const trimmed = line.trim().replace(/ \|\| exit 1$/, '');
  if (!trimmed.startsWith(PREFIX) || !trimmed.endsWith(SUFFIX)) return false;

  const args = trimmed.slice(PREFIX.length, -SUFFIX.length).split(' ').filter(Boolean);
  let sawMaxWarnings = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('-')) return false;
    if (arg === '--max-warnings' || arg.startsWith('--max-warnings=')) sawMaxWarnings = true;
    if (OPTIONS_TAKING_VALUE.has(arg)) {
      // A value-taking option with no following token is a malformed invocation.
      if (i + 1 >= args.length) return false;
      i += 1;
    }
  }
  return sawMaxWarnings;
}

describe('pre-commit eslint batching', () => {
  const hook = fs.readFileSync(PRE_COMMIT, 'utf8');

  it('batches eslint with -- so spaced/option-like paths stay literal', () => {
    const lines = hook.split(/\r?\n/);
    const invocations = lines.filter(isEslintInvocation);
    expect(invocations.length).toBeGreaterThan(0);

    for (const line of invocations) {
      expect(isSafeEslintInvocation(line), `unsafe eslint invocation: ${line}`).toBe(true);
    }

    for (const line of lines) {
      const hasXargs = line.includes('xargs');
      const hasEslint = line.includes('eslint');
      expect(hasXargs && hasEslint, `xargs+eslint on one line: ${line}`).toBe(false);
    }
  });
});
