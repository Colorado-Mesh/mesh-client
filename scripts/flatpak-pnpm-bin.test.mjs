// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  offlinePnpmEnvContractViolations,
  parseMeshClientModuleBuildEnv,
} from './flatpakOfflinePnpmEnv.mjs';

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

  it('requires quoted offline pnpm env strings for flatpak-builder GStrv', () => {
    const yaml = fs.readFileSync(MANIFEST, 'utf8');
    const env = parseMeshClientModuleBuildEnv(yaml);
    expect(env).not.toBeNull();
    expect(env?.PNPM_CONFIG_TRUST_LOCKFILE).toBe('true');
    expect(env?.PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN).toBe('false');
    expect(offlinePnpmEnvContractViolations(yaml)).toEqual([]);
  });

  it('rejects unquoted YAML booleans (GStrv drops the whole env map)', () => {
    const unquoted = `
modules:
  - name: mesh-client
    build-options:
      env:
        PNPM_CONFIG_TRUST_LOCKFILE: true
        PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: false
`;
    expect(offlinePnpmEnvContractViolations(unquoted).length).toBe(2);
    expect(offlinePnpmEnvContractViolations(unquoted)[0].message).toMatch(/GStrv|quoted/);
  });

  it('rejects missing or commented offline pnpm env values', () => {
    const commentedOnly = `
modules:
  - name: mesh-client
    build-options:
      env:
        # PNPM_CONFIG_TRUST_LOCKFILE: 'true'
        # PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false'
        PNPM_HOME: /run/build/mesh-client/.pnpm
`;
    expect(offlinePnpmEnvContractViolations(commentedOnly).length).toBe(2);
  });
});
