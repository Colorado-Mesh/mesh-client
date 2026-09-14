// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PLATFORM_TARGETS } from './reticulum-sidecar-staging.mjs';
import { fileURLToPath } from 'node:url';

function resolve(platforms, sidecars = false) {
  return spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('resolve-release-matrix.mjs', import.meta.url)),
      ...(sidecars ? ['--sidecars'] : []),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, RELEASE_PLATFORMS: platforms },
    },
  );
}

describe('release and sidecar matrices', () => {
  it.each(['all', 'mac', 'linux', 'win', 'linux,win', ' mac, win,mac '])(
    'uses the same platform selection for %s',
    (input) => {
      const packages = resolve(input);
      const sidecars = resolve(input, true);
      expect(packages.status, packages.stderr).toBe(0);
      expect(sidecars.status, sidecars.stderr).toBe(0);
      const packageRows = JSON.parse(packages.stdout);
      const sidecarRows = JSON.parse(sidecars.stdout);
      expect(sidecarRows).toHaveLength(packageRows.length * 2);
      for (const row of packageRows) {
        const targets = sidecarRows.filter((sidecar) => sidecar.platform === row.sidecar_platform);
        expect(targets.map(({ target }) => target)).toEqual(
          PLATFORM_TARGETS[row.sidecar_platform].map(({ cargoTarget }) => cargoTarget),
        );
        expect(targets.every(({ os }) => os === row.os)).toBe(true);
        expect(targets.filter(({ run_tests }) => run_tests).map(({ arch }) => arch)).toEqual([
          row.os === 'macos-latest' ? 'arm64' : 'x64',
        ]);
      }
    },
  );

  it('rejects an empty platform selection for both matrices', () => {
    for (const sidecars of [false, true]) expect(resolve('unknown', sidecars).status).not.toBe(0);
  });
});
