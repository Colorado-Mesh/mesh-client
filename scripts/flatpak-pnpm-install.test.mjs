// @vitest-environment node
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { FLATPAK_PNPM_INSTALL_ARGS } from './flatpak-pnpm-install.mjs';

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'flatpak-pnpm-install.mjs',
);

describe('flatpak-pnpm-install.mjs', () => {
  it('exits non-zero when offline store is unavailable outside sandbox', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: path.resolve(path.dirname(scriptPath), '..'),
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/flatpak-pnpm|ERR_PNPM|offline|no such file/i);
  });

  it('passes trust-lockfile so offline install skips registry supply-chain re-verify', () => {
    expect(FLATPAK_PNPM_INSTALL_ARGS).toContain('--config.trust-lockfile=true');
    expect(FLATPAK_PNPM_INSTALL_ARGS).toContain('--offline');
    expect(FLATPAK_PNPM_INSTALL_ARGS).toContain('--frozen-lockfile');
    expect(FLATPAK_PNPM_INSTALL_ARGS).toContain('--ignore-scripts');
  });
});
