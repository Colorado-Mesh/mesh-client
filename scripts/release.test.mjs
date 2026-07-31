// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_SH = path.join(ROOT, 'scripts/release.sh');
const PACKAGE_JSON = path.join(ROOT, 'package.json');

/** Checks that must always run in release pre-flight (not path-gated like pre-commit). */
const REQUIRED_PNPM_CHECKS = [
  'check:environment',
  'check:electron-security',
  'check:log-injection',
  'check:log-service-sinks',
  'check:codeql-extensions',
  'check:insecure-temp-files',
  'check:db-migrations',
  'check:ipc-contract',
  'check:reticulum-interface-modes',
  'check:pn-hosting-policy',
  'check:reticulum-decommissioned-hubs',
  'check:console-log',
  'check:silent-catches',
  'check:url-hostname-sanitization',
  'check:xss-patterns',
  'check:protocol-string-gates',
  'check:log-panel-filter',
  'check:i18n',
  'check:licenses',
  'check:flatpak',
  'check:flatpak-offline-pnpm',
  'test:run',
  'reticulum:sidecar:test',
];

describe('release.sh full-suite gate', () => {
  const script = fs.readFileSync(RELEASE_SH, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));

  it('package.json test:run is an unrestricted vitest run', () => {
    expect(pkg.scripts['test:run']).toBe('vitest run');
    expect(pkg.scripts['test:staged']).toMatch(/precommit-tests/);
  });

  it('runs pnpm run test:run for the full Vitest suite', () => {
    expect(script).toMatch(/^\s*if ! pnpm run test:run; then\s*$/m);
  });

  it('never invokes staged/related/changed Vitest bypasses', () => {
    expect(script).not.toMatch(/pnpm run test:staged/);
    expect(script).not.toMatch(/pnpm run test:changed/);
    expect(script).not.toMatch(/vitest related\b/);
    expect(script).not.toMatch(/vitest run --changed\b/);
    expect(script).not.toMatch(/precommit-tests\.mjs/);
  });

  it('does not invoke pnpm dedupe --check (hoisted linker mutates node_modules)', () => {
    // Comments may mention the unsafe flag; the active command must not run it.
    expect(script).not.toMatch(/^\s*(?:if ! )?pnpm dedupe --check\b/m);
    expect(script).toMatch(/assert_lockfile_deduped/);
    expect(script).toMatch(/assert_release_clis/);
  });

  it('reads package.json version after pnpm version (never uses pnpm stdout as NEW_VERSION)', () => {
    expect(script).not.toMatch(/^\s*NEW_VERSION=\$\(pnpm version\b/m);
    expect(script).toMatch(/CLEAN_VERSION=\$\(read_package_version\)/);
    expect(script).toMatch(/NEW_VERSION="v\$\{CLEAN_VERSION\}"/);
    expect(script).toMatch(/prepend-metainfo-release\.mjs/);
  });

  it('supports --finish to complete a mid-release without re-bumping', () => {
    expect(script).toMatch(/\[ "\$\{1:-\}" = "--finish" \]/);
    expect(script).toMatch(/finish_pending_release/);
    expect(script).toMatch(/pnpm run release --finish/);
    // Finish path must not re-enter full preflight / update.
    const finishFn = script.slice(script.indexOf('finish_pending_release()'));
    const finishBody = finishFn.slice(0, finishFn.indexOf('\n}\n\n#'));
    expect(finishBody).not.toMatch(/pnpm update\b/);
    expect(finishBody).not.toMatch(/pnpm version\b/);
    expect(finishBody).not.toMatch(/pnpm run test:run/);
  });

  it('requires actionlint and yamllint (no soft-skip)', () => {
    expect(script).toMatch(/actionlint not found/);
    expect(script).toMatch(/yamllint not found/);
    expect(script).not.toMatch(/actionlint not found, skipping/i);
    expect(script).not.toMatch(/yamllint not found, skipping/i);
  });

  it.each(REQUIRED_PNPM_CHECKS)('invokes pnpm run %s', (scriptName) => {
    expect(script).toContain(`pnpm run ${scriptName}`);
  });
});
