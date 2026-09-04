// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
    expect(script).toMatch(/--finish\)/);
    expect(script).toMatch(/FINISH_ONLY=true/);
    expect(script).toMatch(/finish_pending_release/);
    expect(script).toMatch(/pnpm run release --finish/);
    // Finish path must not re-enter full preflight / update.
    const finishFn = script.slice(script.indexOf('finish_pending_release()'));
    const finishBody = finishFn.slice(0, finishFn.indexOf('\n}\n\n#'));
    expect(finishBody).not.toMatch(/pnpm update\b/);
    expect(finishBody).not.toMatch(/pnpm version\b/);
    expect(finishBody).not.toMatch(/pnpm run test:run/);
  });

  it('rebases onto origin/main before push when main advanced during preflight', () => {
    // Cut release can take ~20m; concurrent main merges (e.g. licenses bot) reject a
    // naive `git push origin main`. Rebase+retry, retagging the tip each attempt.
    expect(script).toMatch(/push_release_main_with_rebase/);
    expect(script).toMatch(/git fetch origin main/);
    expect(script).toMatch(/git merge-base --is-ancestor origin\/main HEAD/);
    expect(script).toMatch(/git rebase origin\/main/);
    const helperFn = script.slice(script.indexOf('push_release_main_with_rebase()'));
    const helperBody = helperFn.slice(0, helperFn.indexOf('\n}\n\n'));
    const rebaseIdx = helperBody.indexOf('git rebase origin/main');
    const tagIdx = helperBody.indexOf('git tag -a');
    const pushIdx = helperBody.indexOf('git push origin main');
    expect(rebaseIdx).toBeGreaterThanOrEqual(0);
    expect(tagIdx).toBeGreaterThan(rebaseIdx);
    expect(pushIdx).toBeGreaterThan(tagIdx);
    // Failed abort must surface Git stderr and use a distinct status (not `2>/dev/null || true`).
    expect(helperBody).toMatch(/if ! git rebase --abort; then/);
    expect(helperBody).toMatch(/return 2/);
    expect(helperBody).not.toMatch(/git rebase --abort 2>\s*\/dev\/null/);
  });

  it('supports --yes / MESH_CLIENT_RELEASE_YES to skip confirmation prompts', () => {
    expect(script).toMatch(/confirm_or_yes/);
    expect(script).toMatch(/--yes \| -y\)/);
    expect(script).toMatch(/MESH_CLIENT_RELEASE_YES/);
    expect(script).toMatch(/RELEASE_YES=true/);
    // All interactive confirms go through confirm_or_yes (no bare read -r for y/N).
    expect(script).not.toMatch(/Continue with pre-flight validation\?\$\{NC\} \[y\/N\]/);
    expect(script).toMatch(/confirm_or_yes "Continue with pre-flight validation\?"/);
    expect(script).toMatch(
      /confirm_or_yes "All validations passed\. Proceed with actual release\?"/,
    );
  });

  it('supports --skip-dep-update to skip pnpm update/dedupe', () => {
    expect(script).toMatch(/--skip-dep-update\)/);
    expect(script).toMatch(/SKIP_DEP_UPDATE=true/);
    expect(script).toMatch(/Skipping pnpm update\/dedupe/);
  });

  it('delegates conventional bump detection to detectReleaseBump.mjs (scoped feats)', () => {
    expect(script).toMatch(/detectReleaseBump\.mjs/);
    expect(script).toMatch(/detect_version_bump/);
    expect(script).toMatch(/isSupportedBreakingSubject/);
    // Historical bug: unscoped-only feat: regex missed feat(scope):
    expect(script).not.toMatch(/\^feat\[\[:space:\]\]\*:/);
    // Notes must not use the naive type!: grep (false positives for revert!: etc.)
    expect(script).not.toMatch(/\^\\\* \[\^:\]\+!:/);
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

  it('rejects --auto combined with an explicit bump (text contract)', () => {
    expect(script).toMatch(/--auto cannot be combined with patch\|minor\|major/);
  });
});

describe('release.sh argv subprocess', () => {
  it('rejects --auto patch before side effects', () => {
    const r = spawnSync('bash', [RELEASE_SH, '--auto', 'patch'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/--auto cannot be combined/);
  });

  it('PARSE_ONLY: --yes enables RELEASE_YES without prompts', () => {
    const r = spawnSync('bash', [RELEASE_SH, '--yes', '--auto'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MESH_CLIENT_RELEASE_PARSE_ONLY: '1',
        MESH_CLIENT_ALLOW_PARSE_ONLY_IN_CI: '1',
      },
    });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^RELEASE_YES=true$/m);
    expect(r.stdout).toMatch(/^AUTO_DETECT=true$/m);
  });

  it('PARSE_ONLY: --skip-dep-update sets SKIP_DEP_UPDATE', () => {
    const r = spawnSync('bash', [RELEASE_SH, '--yes', '--skip-dep-update', 'patch'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MESH_CLIENT_RELEASE_PARSE_ONLY: '1',
        MESH_CLIENT_ALLOW_PARSE_ONLY_IN_CI: '1',
      },
    });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^SKIP_DEP_UPDATE=true$/m);
    expect(r.stdout).toMatch(/^VERSION_TYPE=patch$/m);
  });

  it('PARSE_ONLY: ignores bare -- (pnpm 11 run-script separator)', () => {
    // Cut release / docs historically used `pnpm run release -- minor …`.
    // pnpm 11 forwards that `--` into argv; rejecting it broke the workflow.
    const r = spawnSync('bash', [RELEASE_SH, '--', 'minor', '--skip-dep-update'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MESH_CLIENT_RELEASE_PARSE_ONLY: '1',
        MESH_CLIENT_ALLOW_PARSE_ONLY_IN_CI: '1',
        MESH_CLIENT_RELEASE_YES: '1',
      },
    });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^VERSION_TYPE=minor$/m);
    expect(r.stdout).toMatch(/^SKIP_DEP_UPDATE=true$/m);
    expect(r.stdout).toMatch(/^RELEASE_YES=true$/m);
  });

  it('PARSE_ONLY: pnpm run release -- minor --skip-dep-update (Cut release argv)', () => {
    const r = spawnSync('pnpm', ['run', 'release', '--', 'minor', '--skip-dep-update'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        MESH_CLIENT_RELEASE_PARSE_ONLY: '1',
        MESH_CLIENT_ALLOW_PARSE_ONLY_IN_CI: '1',
        MESH_CLIENT_RELEASE_YES: '1',
      },
    });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^VERSION_TYPE=minor$/m);
    expect(r.stdout).toMatch(/^SKIP_DEP_UPDATE=true$/m);
  });

  it('PARSE_ONLY: rejects under GitHub Actions without allow flag', () => {
    const r = spawnSync('bash', [RELEASE_SH, '--yes', '--auto'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MESH_CLIENT_RELEASE_PARSE_ONLY: '1',
        GITHUB_ACTIONS: 'true',
        MESH_CLIENT_ALLOW_PARSE_ONLY_IN_CI: '',
      },
    });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/cannot run under GitHub Actions/);
  });

  it('PARSE_ONLY: MESH_CLIENT_RELEASE_YES without --yes', () => {
    const r = spawnSync('bash', [RELEASE_SH, '--auto'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MESH_CLIENT_RELEASE_PARSE_ONLY: '1',
        MESH_CLIENT_ALLOW_PARSE_ONLY_IN_CI: '1',
        MESH_CLIENT_RELEASE_YES: '1',
      },
    });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^RELEASE_YES=true$/m);
  });

  it('skip-dep-update does not run pnpm update/dedupe (stubbed git + pnpm)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-release-argv-'));
    try {
      const bin = path.join(tmp, 'bin');
      const pnpmLog = path.join(tmp, 'pnpm.log');
      fs.mkdirSync(bin);
      fs.writeFileSync(
        path.join(bin, 'git'),
        `#!/usr/bin/env bash
set -e
case "$*" in
  *'rev-parse --abbrev-ref HEAD'*|*rev-parse*abbrev-ref*)
    echo main
    exit 0
    ;;
  *pull*)
    exit 0
    ;;
  *'describe --tags'*|*describe*)
    echo v9.9.9
    exit 0
    ;;
  *log*)
    echo "deadbeef feat: stub commit"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`,
        { mode: 0o755 },
      );
      fs.writeFileSync(
        path.join(bin, 'pnpm'),
        `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(pnpmLog)}
# Fail after recording so preflight cannot mutate the repo.
exit 1
`,
        { mode: 0o755 },
      );

      const r = spawnSync('bash', [RELEASE_SH, '--yes', '--skip-dep-update', 'patch'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
          MESH_CLIENT_RELEASE_YES: '1',
        },
      });
      expect(r.status).not.toBe(0);
      const log = fs.existsSync(pnpmLog) ? fs.readFileSync(pnpmLog, 'utf8') : '';
      expect(log).not.toMatch(/(^|\n)update(\s|$)/);
      expect(log).not.toMatch(/(^|\n)dedupe(\s|$)/);
      expect(`${r.stdout}${r.stderr}`).toMatch(/Skipping pnpm update\/dedupe/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
