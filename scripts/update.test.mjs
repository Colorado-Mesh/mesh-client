import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const updateScriptPath = fileURLToPath(new URL('./update.sh', import.meta.url));
const updateScript = readFileSync(updateScriptPath, 'utf8');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // catch-no-log-ok best-effort temp cleanup
    }
  }
});

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [cwd]
 * @param {string} [scriptPath]
 */
function runUpdate(args, env = {}, cwd = repoRoot, scriptPath = updateScriptPath) {
  return spawnSync('bash', [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('update.sh Reticulum stack functionality check', () => {
  it('prepares and requires every rs path dependency before the full-feature build', () => {
    const rebuildFunction = updateScript.match(
      /rebuild_reticulum_sidecar\(\) \{([\s\S]*?)^\}/m,
    )?.[1];

    expect(rebuildFunction).toBeDefined();
    expect(rebuildFunction).toContain('bash scripts/clone-ratspeak-stack.sh');
    expect(rebuildFunction).toContain('../.rsstack/rsReticulum/crates/rns-runtime/Cargo.toml');
    expect(rebuildFunction).toContain('../.rsstack/rsLXMF/crates/lxmf-core/Cargo.toml');
    expect(rebuildFunction).toContain('../.rsstack/rsNomad/crates/nomad-core/Cargo.toml');
    expect(rebuildFunction).toContain('cargo build --features rns-stack,rns-ble,rns-rnode-tcp');
    expect(rebuildFunction).not.toMatch(/['"]\.\.\/rs(?:Reticulum|LXMF|Nomad)\//);
    expect(rebuildFunction).not.toContain('cargo build)');
    expect(rebuildFunction).toContain('CLEAN_SIDECAR_TARGET');
    expect(rebuildFunction).toContain('cargo clean');
    // Clean only after a successful build, and only when opted in.
    const buildIdx = rebuildFunction.indexOf(
      'cargo build --features rns-stack,rns-ble,rns-rnode-tcp',
    );
    const cleanIdx = rebuildFunction.indexOf('cargo clean');
    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(cleanIdx).toBeGreaterThan(buildIdx);
    expect(rebuildFunction).toMatch(
      /if \[ "\$\{CLEAN_SIDECAR_TARGET\}" = '1' \]; then[\s\S]*cargo clean/,
    );
  });

  it('defaults CLEAN_SIDECAR_TARGET to 0 (parse-only)', () => {
    const result = runUpdate([], { UPDATE_SH_TEST_HOOK: 'parse-only' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('CLEAN_SIDECAR_TARGET=0');
  });

  it('opts in via CLEAN_SIDECAR_TARGET=1 (parse-only)', () => {
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'parse-only',
      CLEAN_SIDECAR_TARGET: '1',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('CLEAN_SIDECAR_TARGET=1');
  });

  it('opts in via --clean-target (parse-only)', () => {
    const result = runUpdate(['--clean-target'], { UPDATE_SH_TEST_HOOK: 'parse-only' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('CLEAN_SIDECAR_TARGET=1');
  });

  it('rejects unknown arguments', () => {
    const result = runUpdate(['--nope']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown argument: --nope');
    expect(result.stderr).toContain('Usage: scripts/update.sh [--clean-target]');
  });

  it('prints Ratspeak upstream catalog (upstream-catalog-only)', () => {
    const result = runUpdate([], { UPDATE_SH_TEST_HOOK: 'upstream-catalog-only' });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('RATSPEAK_RELEASE_WATCH_ENTRIES:');
    expect(result.stdout).toContain('ratspeak/rsLXST||rsLXST voice (lxst-telephony)');
    expect(result.stdout).toContain('ratspeak/lrgp-rs||lrgp-rs games (LRGP)');
    expect(result.stdout).toContain(
      'ratspeak/Ratspeak|games-parity|Ratspeak client (review Games tab parity)',
    );
    expect(result.stdout).toContain('ratspeak/LXMFace||');
    expect(updateScript).toContain('"${stub}" = \'games-parity\'');
    expect(updateScript).toContain('docs/reticulum-games-parity.md');
    expect(result.stdout).toContain('RATSPEAK_KNOWN_ORG_REPOS:');
    expect(result.stdout).toContain('  rsReticulum');
    expect(result.stdout).toContain('  rsLXMF');
    expect(result.stdout).toContain('  rsLXST');
    expect(result.stdout).toContain('  lrgp-rs');
  });

  it('wires check_ratspeak_upstream after overlay PR checks', () => {
    expect(updateScript).toContain('check_ratspeak_upstream()');
    expect(updateScript).toContain('RATSPEAK_RELEASE_WATCH_ENTRIES');
    expect(updateScript).toContain('RATSPEAK_KNOWN_ORG_REPOS');
    expect(updateScript).toContain('warn_github_api_rate_limit_once');
    expect(updateScript).toContain('return 2');
    expect(updateScript).toContain('\\u0000-\\u001F\\u007F');
    const patchesCall = updateScript.lastIndexOf('\ncheck_ratspeak_patches\n');
    const upstreamCall = updateScript.lastIndexOf('\ncheck_ratspeak_upstream\n');
    expect(patchesCall).toBeGreaterThanOrEqual(0);
    expect(upstreamCall).toBeGreaterThan(patchesCall);
  });

  /**
   * @param {'release' | 'rate-limit' | 'malformed' | 'missing'} mode
   */
  function prepareUpstreamGhFixture(mode) {
    const work = mkdtempSync(path.join(os.tmpdir(), 'mesh-update-upstream-'));
    tempDirs.push(work);
    const binDir = path.join(work, 'bin');
    mkdirSync(binDir, { recursive: true });
    const releasePath = path.join(work, 'release.json');
    const reposPath = path.join(work, 'repos.json');
    if (mode === 'release') {
      writeFileSync(
        releasePath,
        JSON.stringify({
          tag_name: 'v9.9.9',
          published_at: '2026-08-01T00:00:00Z',
          body: 'First line\nSecond',
        }),
      );
      writeFileSync(reposPath, '[]');
    } else if (mode === 'rate-limit') {
      writeFileSync(releasePath, JSON.stringify({ message: 'API rate limit exceeded for ...' }));
      writeFileSync(reposPath, JSON.stringify({ message: 'API rate limit exceeded' }));
    } else if (mode === 'malformed') {
      writeFileSync(releasePath, '{not-json');
      writeFileSync(reposPath, '[]');
    } else {
      writeFileSync(releasePath, JSON.stringify({ message: 'Not Found' }));
      writeFileSync(reposPath, '[]');
    }
    const ghPath = path.join(binDir, 'gh');
    writeFileSync(
      ghPath,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" != "api" ]]; then
  echo "unexpected gh args: $*" >&2
  exit 1
fi
path="\${2:-}"
if [[ "$path" == repos/*/releases/latest ]]; then
  cat ${JSON.stringify(releasePath)}
  exit 0
fi
if [[ "$path" == orgs/ratspeak/repos* ]]; then
  cat ${JSON.stringify(reposPath)}
  exit 0
fi
printf '%s' '{}'
exit 0
`,
      'utf8',
    );
    chmodSync(ghPath, 0o755);
    return { work, binDir };
  }

  it('upstream-check-only parses a valid release non-fatally', () => {
    const fixture = prepareUpstreamGhFixture('release');
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'upstream-check-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('v9.9.9');
    expect(result.stdout).toContain('First line');
    expect(result.stdout).not.toContain('GitHub API rate limit:');
  });

  it('upstream-check-only warns on rate-limit without failing', () => {
    const fixture = prepareUpstreamGhFixture('rate-limit');
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'upstream-check-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('GitHub API rate limit:');
  });

  it('upstream-check-only tolerates malformed repository JSON', () => {
    const fixture = prepareUpstreamGhFixture('malformed');
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'upstream-check-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('no GitHub release (or query failed)');
  });

  it('upstream-check-only tolerates missing releases', () => {
    const fixture = prepareUpstreamGhFixture('missing');
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'upstream-check-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('no GitHub release (or query failed)');
  });

  it('runs cargo clean after a successful rebuild when CLEAN_SIDECAR_TARGET=1', () => {
    const fixture = prepareRebuildFixture({ buildExit: 0 });
    const result = runUpdate(
      [],
      {
        UPDATE_SH_TEST_HOOK: 'rebuild-only',
        CLEAN_SIDECAR_TARGET: '1',
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
      },
      fixture.work,
      fixture.scriptPath,
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const log = readFileSync(fixture.cargoLog, 'utf8');
    expect(log).toContain('build --features rns-stack,rns-ble,rns-rnode-tcp');
    expect(log).toContain('clean');
    expect(log.indexOf('build')).toBeLessThan(log.indexOf('clean'));
  });

  it('skips cargo clean by default after a successful rebuild', () => {
    const fixture = prepareRebuildFixture({ buildExit: 0 });
    const result = runUpdate(
      [],
      {
        UPDATE_SH_TEST_HOOK: 'rebuild-only',
        CLEAN_SIDECAR_TARGET: '0',
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
      },
      fixture.work,
      fixture.scriptPath,
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const log = readFileSync(fixture.cargoLog, 'utf8');
    expect(log).toContain('build --features rns-stack,rns-ble,rns-rnode-tcp');
    expect(log).not.toContain('clean');
  });

  it('does not run cargo clean when the rebuild fails', () => {
    const fixture = prepareRebuildFixture({ buildExit: 1 });
    const result = runUpdate(
      [],
      {
        UPDATE_SH_TEST_HOOK: 'rebuild-only',
        CLEAN_SIDECAR_TARGET: '1',
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
      },
      fixture.work,
      fixture.scriptPath,
    );
    expect(result.status).not.toBe(0);
    const log = readFileSync(fixture.cargoLog, 'utf8');
    expect(log).toContain('build --features rns-stack,rns-ble,rns-rnode-tcp');
    expect(log).not.toContain('clean');
  });
});

/**
 * Temp layout matching the repo-local .rsstack workspace: mesh-client/reticulum-sidecar +
 * .rsstack/{rsReticulum,rsLXMF,rsNomad,rsLXST,lrgp-rs}.
 * @param {{ buildExit: number }} opts
 */
function prepareRebuildFixture(opts) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-update-root-'));
  tempDirs.push(root);
  const work = path.join(root, 'mesh-client');
  const binDir = mkdtempSync(path.join(os.tmpdir(), 'mesh-update-bin-'));
  tempDirs.push(binDir);
  const cargoLog = path.join(binDir, 'cargo.log');

  writeFileSync(
    path.join(binDir, 'cargo'),
    `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(cargoLog)}
if [[ "$*" == build* ]]; then
  exit ${opts.buildExit}
fi
exit 0
`,
    { encoding: 'utf8' },
  );
  chmodSync(path.join(binDir, 'cargo'), 0o755);

  mkdirSync(path.join(work, 'scripts'), { recursive: true });
  writeFileSync(
    path.join(work, 'scripts', 'clone-ratspeak-stack.sh'),
    '#!/usr/bin/env bash\nexit 0\n',
  );
  chmodSync(path.join(work, 'scripts', 'clone-ratspeak-stack.sh'), 0o755);
  const scriptPath = path.join(work, 'scripts', 'update.sh');
  writeFileSync(scriptPath, updateScript);
  chmodSync(scriptPath, 0o755);

  mkdirSync(path.join(work, 'reticulum-sidecar'), { recursive: true });
  writeFileSync(
    path.join(work, 'reticulum-sidecar', 'Cargo.toml'),
    '[package]\nname = "mesh-client-reticulum"\n',
  );
  // Path deps are ../.rsstack/rs* from reticulum-sidecar → repo-local .rsstack workspace.
  for (const rel of [
    'rsReticulum/crates/rns-runtime/Cargo.toml',
    'rsLXMF/crates/lxmf-core/Cargo.toml',
    'rsNomad/crates/nomad-core/Cargo.toml',
    'rsLXST/crates/lxst-telephony/Cargo.toml',
    'lrgp-rs/Cargo.toml',
  ]) {
    const abs = path.join(work, '.rsstack', rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, '[package]\nname = "stub"\n');
  }

  return { work, binDir, cargoLog, scriptPath };
}
