// @vitest-environment node
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { describe, expect, it } from 'vitest';

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'dist-win-hoisted-install.mjs',
);

describe('dist-win-hoisted-install.mjs', () => {
  it('skips pnpm install when CI=true', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: { ...process.env, CI: 'true' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('skipping redundant hoisted install');
  });
});
