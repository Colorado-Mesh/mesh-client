// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'org.coloradomesh.MeshClient.yml');

describe('Flatpak pnpm standalone install', () => {
  it('copies pnpm-vendor/dist beside the wrapper binary (pnpm 11+ needs dist/pnpm.mjs)', () => {
    const yaml = fs.readFileSync(MANIFEST, 'utf8');
    expect(yaml).toMatch(
      /install -Dm755 pnpm-vendor\/pnpm \/run\/build\/mesh-client\/\.pnpm-bin\/pnpm/,
    );
    expect(yaml).toMatch(/cp -a pnpm-vendor\/dist \/run\/build\/mesh-client\/\.pnpm-bin\/dist/);
  });

  it('disables registry supply-chain re-verify and verifyDepsBeforeRun for offline builds', () => {
    const yaml = fs.readFileSync(MANIFEST, 'utf8');
    expect(yaml).toMatch(/PNPM_CONFIG_TRUST_LOCKFILE:\s*['"]?true['"]?/);
    expect(yaml).toMatch(/PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN:\s*['"]?false['"]?/);
  });
});
