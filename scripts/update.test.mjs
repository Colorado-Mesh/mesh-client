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
    expect(result.stdout).toContain('ratspeak/rsLXST||rsLXST voice (lxst-telephony)|v0.2.0');
    expect(result.stdout).toContain('ratspeak/lrgp-rs||lrgp-rs games (LRGP)|v0.4.1');
    expect(result.stdout).toContain(
      'ratspeak/Ratspeak|games-parity|Ratspeak client (review Games tab parity)|v1.0.30',
    );
    expect(result.stdout).toContain('ratspeak/LXMFace||');
    expect(result.stdout).toContain('file:js/lxmface.js@308a729d5bf951880633e5e174b3b7628203106b');
    expect(updateScript).toContain('"${stub}" = \'games-parity\'');
    expect(updateScript).toContain('docs/reticulum-games-parity.md');
    expect(updateScript).toContain('reviewed-ref');
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

  it('syncs Flatpak Electron archives after pnpm prune', () => {
    expect(updateScript).toContain('sync_flatpak_electron()');
    expect(updateScript).toContain('node scripts/sync-flatpak-electron.mjs');
    const pruneIdx = updateScript.lastIndexOf("echo 'Running pnpm prune...'");
    const syncCallIdx = updateScript.lastIndexOf('\nsync_flatpak_electron\n');
    const rustIdx = updateScript.lastIndexOf('\nupdate_rust_toolchain\n');
    expect(pruneIdx).toBeGreaterThanOrEqual(0);
    expect(syncCallIdx).toBeGreaterThan(pruneIdx);
    expect(rustIdx).toBeGreaterThan(syncCallIdx);
  });

  const LXMFACE_REVIEWED_SHA = '308a729d5bf951880633e5e174b3b7628203106b';

  /**
   * @param {'release' | 'rate-limit' | 'malformed' | 'missing'} mode
   * @param {{
   *   releases?: Record<string, unknown>
   *   commits?: Record<string, unknown>
   *   compare?: unknown
   * }} [extra]
   */
  function prepareUpstreamGhFixture(mode, extra = {}) {
    const work = mkdtempSync(path.join(os.tmpdir(), 'mesh-update-upstream-'));
    tempDirs.push(work);
    const binDir = path.join(work, 'bin');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(path.join(work, 'releases'), { recursive: true });
    mkdirSync(path.join(work, 'commits'), { recursive: true });
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
    for (const [repo, payload] of Object.entries(extra.releases ?? {})) {
      writeFileSync(
        path.join(work, 'releases', `${repo.replaceAll('/', '-')}.json`),
        typeof payload === 'string' ? payload : JSON.stringify(payload),
      );
    }
    for (const [repo, payload] of Object.entries(extra.commits ?? {})) {
      writeFileSync(
        path.join(work, 'commits', `${repo.replaceAll('/', '-')}.json`),
        typeof payload === 'string' ? payload : JSON.stringify(payload),
      );
    }
    writeFileSync(path.join(work, 'compare.json'), JSON.stringify(extra.compare ?? { files: [] }));
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
  repo="\${path#repos/}"
  repo="\${repo%/releases/latest}"
  slug="\${repo//\\//-}"
  per=${JSON.stringify(path.join(work, 'releases'))}/"\${slug}.json"
  if [[ -f "$per" ]]; then
    cat "$per"
    exit 0
  fi
  cat ${JSON.stringify(releasePath)}
  exit 0
fi
if [[ "$path" == repos/*/commits* ]]; then
  repo="\${path#repos/}"
  repo="\${repo%%/commits*}"
  slug="\${repo//\\//-}"
  per=${JSON.stringify(path.join(work, 'commits'))}/"\${slug}.json"
  if [[ -f "$per" ]]; then
    cat "$per"
    exit 0
  fi
  printf '%s' '[]'
  exit 0
fi
if [[ "$path" == repos/*/compare/* ]]; then
  cat ${JSON.stringify(path.join(work, 'compare.json'))}
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

  /** Current reviewed-ref pins: no warn_box. */
  function currentBaselineExtra() {
    return {
      releases: {
        'ratspeak/rsLXST': {
          tag_name: 'v0.2.0',
          published_at: '2026-08-17T23:34:17Z',
          body: 'rsLXST v0.2.0',
        },
        'ratspeak/lrgp-rs': {
          tag_name: 'v0.4.1',
          published_at: '2026-08-17T23:34:25Z',
          body: 'lrgp-rs v0.4.1',
        },
        'ratspeak/Ratspeak': {
          tag_name: 'v1.0.30',
          published_at: '2026-08-24T09:26:44Z',
          body: 'Fixed message reactions, replies, copying, and text selection.',
        },
      },
      commits: {
        'ratspeak/LXMFace': [{ sha: LXMFACE_REVIEWED_SHA }],
      },
    };
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
    expect(result.stdout).toContain('no published GitHub release');
    expect(result.stdout).not.toContain('query failed');
  });

  it('upstream-check-only tolerates missing releases', () => {
    const fixture = prepareUpstreamGhFixture('missing');
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'upstream-check-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('no published GitHub release');
    expect(result.stdout).not.toContain('query failed');
    expect(result.stdout).not.toContain('WARNING:');
  });

  it('upstream-check-only stays quiet when published releases match reviewed-ref', () => {
    const fixture = prepareUpstreamGhFixture('release', currentBaselineExtra());
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'upstream-check-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('v1.0.30');
    expect(result.stdout).toContain('reviewed; current');
    expect(result.stdout).toContain('js/lxmface.js @ 308a729d5bf9 (reviewed; current)');
    expect(result.stdout).toContain('v0.4.1');
    expect(result.stdout).toContain(
      'Ratspeak upstream watch complete (reviewed baselines current; no new-repo warnings).',
    );
    expect(result.stdout).not.toContain('WARNING:');
    expect(result.stdout).not.toContain('Four in a Row');
    expect(result.stdout).not.toContain('query failed');
  });

  it('upstream-check-only warns when a published Ratspeak release is newer than the pin', () => {
    const fixture = prepareUpstreamGhFixture('release', {
      ...currentBaselineExtra(),
      releases: {
        ...currentBaselineExtra().releases,
        'ratspeak/Ratspeak': {
          tag_name: 'v9.9.9',
          published_at: '2026-08-01T00:00:00Z',
          body: 'First line\nSecond',
        },
      },
    });
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'upstream-check-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('WARNING:');
    expect(result.stdout).toContain('v1.0.30');
    expect(result.stdout).toContain('v9.9.9');
    expect(result.stdout).toContain('docs/reticulum-games-parity.md');
    expect(result.stdout).not.toContain('Four in a Row');
  });

  it('upstream-check-only hints Four in a Row when the published release body mentions it', () => {
    const fixture = prepareUpstreamGhFixture('release', {
      ...currentBaselineExtra(),
      releases: {
        ...currentBaselineExtra().releases,
        'ratspeak/Ratspeak': {
          tag_name: 'v9.9.9',
          published_at: '2026-08-01T00:00:00Z',
          body: 'Added Four in a Row\nOther notes',
        },
      },
    });
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'upstream-check-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('WARNING:');
    expect(result.stdout).toContain(
      'This published release includes Four in a Row — update Games UI + docs/reticulum-games-parity.md',
    );
  });

  it('upstream-check-only hints Four in a Row when the compare diff mentions it', () => {
    const fixture = prepareUpstreamGhFixture('release', {
      ...currentBaselineExtra(),
      releases: {
        ...currentBaselineExtra().releases,
        'ratspeak/Ratspeak': {
          tag_name: 'v9.9.9',
          published_at: '2026-08-01T00:00:00Z',
          body: 'Protocol refresh only',
        },
      },
      compare: {
        files: [
          {
            filename: 'crates/ratspeak-tauri/src/commands/games.rs',
            patch: '+    "four_in_a_row",',
          },
        ],
      },
    });
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'upstream-check-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(
      'This published release includes Four in a Row — update Games UI + docs/reticulum-games-parity.md',
    );
  });

  it('upstream-check-only warns when the vendored LXMFace file commit changes', () => {
    const fixture = prepareUpstreamGhFixture('release', {
      ...currentBaselineExtra(),
      commits: {
        'ratspeak/LXMFace': [{ sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
      },
    });
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'upstream-check-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('WARNING:');
    expect(result.stdout).toContain('308a729d5bf9');
    expect(result.stdout).toContain('aaaaaaaaaaaa');
    expect(result.stdout).toContain('src/renderer/lib/reticulum/lxmface.ts');
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
