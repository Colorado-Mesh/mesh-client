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

/**
 * Safe form: `pnpm exec eslint --cache --max-warnings 0 -- "$@"` (+ optional `|| exit 1`).
 * @param {string} line
 * @returns {boolean}
 */
function isSafeEslintInvocation(line) {
  const trimmed = line.trim();
  const base = 'pnpm exec eslint --cache --max-warnings 0 -- "$@"';
  return trimmed === base || trimmed === `${base} || exit 1`;
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
