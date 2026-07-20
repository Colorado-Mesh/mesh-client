// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRE_COMMIT = path.join(ROOT, '.githooks/pre-commit');

describe('pre-commit eslint batching', () => {
  const hook = fs.readFileSync(PRE_COMMIT, 'utf8');

  it('batches eslint with -- so spaced/option-like paths stay literal', () => {
    expect(hook).toMatch(/pnpm exec eslint --cache --max-warnings 0 -- "\$@"/);
    expect(hook).not.toMatch(/xargs\s+-n\s+50\s+pnpm exec eslint/);
  });
});
